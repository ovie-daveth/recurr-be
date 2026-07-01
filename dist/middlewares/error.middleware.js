"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorMiddleware = void 0;
const zod_1 = require("zod");
const errors_1 = require("../lib/errors");
const errorMiddleware = (err, req, res, _next) => {
    if (err instanceof errors_1.ApiError) {
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
    if (err instanceof zod_1.ZodError) {
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
exports.errorMiddleware = errorMiddleware;
