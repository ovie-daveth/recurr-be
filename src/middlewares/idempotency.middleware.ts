import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { Prisma } from "../generated/prisma/client";
import { ApiError, requireBusiness } from "../lib/errors";
import { prisma } from "../lib/prisma";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const objectValue = value as Record<string, unknown>;
  return `{${Object.keys(objectValue)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`)
    .join(",")}}`;
}

function hashRequestBody(body: unknown) {
  return crypto.createHash("sha256").update(stableStringify(body)).digest("hex");
}

function getRouteKey(req: Request) {
  return `${req.baseUrl}${req.route?.path ?? req.path}`;
}

async function findExistingIdempotencyRecord(input: {
  businessId: string;
  method: string;
  route: string;
  key: string;
}) {
  return prisma.idempotencyKey.findUnique({
    where: {
      businessId_method_route_key: input,
    },
  });
}

export async function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const business = requireBusiness(req);
    const key = req.header("idempotency-key")?.trim();

    if (!key) {
      next();
      return;
    }

    if (key.length < 8 || key.length > 255) {
      throw new ApiError(
        400,
        "Idempotency-Key must be between 8 and 255 characters",
        [],
        "INVALID_IDEMPOTENCY_KEY"
      );
    }

    const method = req.method.toUpperCase();
    const route = getRouteKey(req);
    const requestHash = hashRequestBody(req.body);

    const existing = await findExistingIdempotencyRecord({
      businessId: business.id,
      method,
      route,
      key,
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ApiError(
          409,
          "Idempotency-Key was already used with a different request payload",
          [],
          "IDEMPOTENCY_KEY_REUSED"
        );
      }

      if (!existing.completedAt || !existing.responseBody || !existing.statusCode) {
        throw new ApiError(
          409,
          "A request with this Idempotency-Key is still processing",
          [],
          "IDEMPOTENCY_REQUEST_IN_PROGRESS"
        );
      }

      res.setHeader("Idempotent-Replayed", "true");
      res.status(existing.statusCode).json(existing.responseBody);
      return;
    }

    let idempotencyRecord;
    try {
      idempotencyRecord = await prisma.idempotencyKey.create({
        data: {
          businessId: business.id,
          method,
          route,
          key,
          requestHash,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const concurrentRecord = await findExistingIdempotencyRecord({
          businessId: business.id,
          method,
          route,
          key,
        });

        if (concurrentRecord?.requestHash !== requestHash) {
          throw new ApiError(
            409,
            "Idempotency-Key was already used with a different request payload",
            [],
            "IDEMPOTENCY_KEY_REUSED"
          );
        }

        throw new ApiError(
          409,
          "A request with this Idempotency-Key is still processing",
          [],
          "IDEMPOTENCY_REQUEST_IN_PROGRESS"
        );
      }

      throw error;
    }

    const originalJson = res.json.bind(res);
    let responseBody: unknown;

    res.json = (body: unknown) => {
      responseBody = body;
      return originalJson(body);
    };

    res.on("finish", () => {
      if (res.statusCode >= 200 && res.statusCode < 400) {
        void prisma.idempotencyKey
          .update({
            where: { id: idempotencyRecord.id },
            data: {
              responseBody: responseBody as Prisma.InputJsonValue,
              statusCode: res.statusCode,
              completedAt: new Date(),
            },
          })
          .catch((error) => {
            console.error("Failed to store idempotency response", error);
          });
        return;
      }

      void prisma.idempotencyKey
        .delete({ where: { id: idempotencyRecord.id } })
        .catch(() => undefined);
    });

    next();
  } catch (error) {
    next(error);
  }
}
