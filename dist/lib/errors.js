"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiError = void 0;
exports.requireBusiness = requireBusiness;
exports.requireMerchantUser = requireMerchantUser;
exports.requireApiKey = requireApiKey;
exports.requireBusinessMode = requireBusinessMode;
class ApiError extends Error {
    statusCode;
    details;
    code;
    constructor(statusCode, message, details, code = statusCodeToErrorCode(statusCode)) {
        super(message);
        this.statusCode = statusCode;
        this.details = details;
        this.code = code;
    }
}
exports.ApiError = ApiError;
function statusCodeToErrorCode(statusCode) {
    switch (statusCode) {
        case 400:
            return "BAD_REQUEST";
        case 401:
            return "UNAUTHORIZED";
        case 403:
            return "FORBIDDEN";
        case 404:
            return "NOT_FOUND";
        case 409:
            return "CONFLICT";
        case 422:
            return "UNPROCESSABLE_ENTITY";
        case 429:
            return "RATE_LIMITED";
        default:
            return statusCode >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_FAILED";
    }
}
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
function requireApiKey(req) {
    if (!req.apiKey) {
        throw new ApiError(401, "API key context is required");
    }
    return req.apiKey;
}
function requireBusinessMode(req) {
    if (!req.businessMode) {
        throw new ApiError(400, "Business mode context is required", [], "BUSINESS_MODE_REQUIRED");
    }
    return req.businessMode;
}
