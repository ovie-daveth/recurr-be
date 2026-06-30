"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.idempotencyMiddleware = idempotencyMiddleware;
const crypto_1 = __importDefault(require("crypto"));
const client_1 = require("../generated/prisma/client");
const errors_1 = require("../lib/errors");
const prisma_1 = require("../lib/prisma");
function stableStringify(value) {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    }
    const objectValue = value;
    return `{${Object.keys(objectValue)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`)
        .join(",")}}`;
}
function hashRequestBody(body) {
    return crypto_1.default.createHash("sha256").update(stableStringify(body)).digest("hex");
}
function getRouteKey(req) {
    return `${req.baseUrl}${req.route?.path ?? req.path}`;
}
async function findExistingIdempotencyRecord(input) {
    return prisma_1.prisma.idempotencyKey.findUnique({
        where: {
            businessId_method_route_key: input,
        },
    });
}
async function idempotencyMiddleware(req, res, next) {
    try {
        const business = (0, errors_1.requireBusiness)(req);
        const key = req.header("idempotency-key")?.trim();
        if (!key) {
            next();
            return;
        }
        if (key.length < 8 || key.length > 255) {
            throw new errors_1.ApiError(400, "Idempotency-Key must be between 8 and 255 characters", [], "INVALID_IDEMPOTENCY_KEY");
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
                throw new errors_1.ApiError(409, "Idempotency-Key was already used with a different request payload", [], "IDEMPOTENCY_KEY_REUSED");
            }
            if (!existing.completedAt || !existing.responseBody || !existing.statusCode) {
                throw new errors_1.ApiError(409, "A request with this Idempotency-Key is still processing", [], "IDEMPOTENCY_REQUEST_IN_PROGRESS");
            }
            res.setHeader("Idempotent-Replayed", "true");
            res.status(existing.statusCode).json(existing.responseBody);
            return;
        }
        let idempotencyRecord;
        try {
            idempotencyRecord = await prisma_1.prisma.idempotencyKey.create({
                data: {
                    businessId: business.id,
                    method,
                    route,
                    key,
                    requestHash,
                },
            });
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                error.code === "P2002") {
                const concurrentRecord = await findExistingIdempotencyRecord({
                    businessId: business.id,
                    method,
                    route,
                    key,
                });
                if (concurrentRecord?.requestHash !== requestHash) {
                    throw new errors_1.ApiError(409, "Idempotency-Key was already used with a different request payload", [], "IDEMPOTENCY_KEY_REUSED");
                }
                throw new errors_1.ApiError(409, "A request with this Idempotency-Key is still processing", [], "IDEMPOTENCY_REQUEST_IN_PROGRESS");
            }
            throw error;
        }
        const originalJson = res.json.bind(res);
        let responseBody;
        res.json = (body) => {
            responseBody = body;
            return originalJson(body);
        };
        res.on("finish", () => {
            if (res.statusCode >= 200 && res.statusCode < 400) {
                void prisma_1.prisma.idempotencyKey
                    .update({
                    where: { id: idempotencyRecord.id },
                    data: {
                        responseBody: responseBody,
                        statusCode: res.statusCode,
                        completedAt: new Date(),
                    },
                })
                    .catch((error) => {
                    console.error("Failed to store idempotency response", error);
                });
                return;
            }
            void prisma_1.prisma.idempotencyKey
                .delete({ where: { id: idempotencyRecord.id } })
                .catch(() => undefined);
        });
        next();
    }
    catch (error) {
        next(error);
    }
}
