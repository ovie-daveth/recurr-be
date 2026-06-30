import type { Response } from "express";

export function sendSuccess(
  res: Response,
  statusCode: number,
  message: string,
  data: Record<string, unknown> = {}
) {
  return res.status(statusCode).json({
    status: true,
    code: statusCode,
    message,
    data,
  });
}
