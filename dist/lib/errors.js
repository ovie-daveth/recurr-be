"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiError = void 0;
exports.requireTenant = requireTenant;
class ApiError extends Error {
    statusCode;
    details;
    constructor(statusCode, message, details) {
        super(message);
        this.statusCode = statusCode;
        this.details = details;
    }
}
exports.ApiError = ApiError;
function requireTenant(req) {
    if (!req.tenant) {
        throw new ApiError(401, "Tenant context is required");
    }
    return req.tenant;
}
