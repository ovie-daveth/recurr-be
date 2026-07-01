import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { ApiError } from "../lib/errors";

export const errorMiddleware: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        statusCode: err.statusCode,
        message: err.message,
        details: err.details ?? [],
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_FAILED",
        statusCode: 400,
        message: "Validation failed",
        details: err.issues,
      },
    });
    return;
  }

  console.error({
    requestId: req.requestId,
    error: err,
  });
  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      statusCode: 500,
      message: "Internal server error",
      details: [],
    },
  });
};
