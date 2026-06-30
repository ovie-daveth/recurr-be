"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSuccess = sendSuccess;
function sendSuccess(res, statusCode, message, data = {}) {
    return res.status(statusCode).json({
        status: true,
        code: statusCode,
        message,
        data,
    });
}
