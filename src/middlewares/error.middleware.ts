import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { ApiError } from "../lib/errors";

export const errorMiddleware: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
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
        message: "Validation failed",
        details: err.issues,
      },
    });
    return;
  }

  console.error(err);
  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
      details: [],
    },
  });
};
