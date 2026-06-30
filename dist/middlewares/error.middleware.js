"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorMiddleware = void 0;
const zod_1 = require("zod");
const errors_js_1 = require("../lib/errors.js");
const errorMiddleware = (err, _req, res, _next) => {
    if (err instanceof errors_js_1.ApiError) {
        res.status(err.statusCode).json({
            error: err.message,
            details: err.details,
        });
        return;
    }
    if (err instanceof zod_1.ZodError) {
        res.status(400).json({
            error: "Validation failed",
            details: err.issues,
        });
        return;
    }
    console.error(err);
    res.status(500).json({
        error: "Internal server error",
    });
};
exports.errorMiddleware = errorMiddleware;
