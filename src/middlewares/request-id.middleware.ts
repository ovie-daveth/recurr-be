import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";

const REQUEST_ID_HEADER = "X-Request-Id";
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{8,128}$/;

function normalizeRequestId(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return REQUEST_ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId =
    normalizeRequestId(req.header(REQUEST_ID_HEADER)) ?? crypto.randomUUID();

  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);

  next();
}
