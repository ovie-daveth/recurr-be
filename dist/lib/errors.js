"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiError = void 0;
exports.requireBusiness = requireBusiness;
exports.requireMerchantUser = requireMerchantUser;
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
function requireBusiness(req) {
    if (!req.business) {
        throw new ApiError(401, "Business context is required");
    }
    return req.business;
}
function requireMerchantUser(req) {
    if (!req.merchantUser) {
        throw new ApiError(401, "Merchant user context is required");
    }
    return req.merchantUser;
}
