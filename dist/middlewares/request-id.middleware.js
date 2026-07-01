"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestIdMiddleware = requestIdMiddleware;
const crypto_1 = __importDefault(require("crypto"));
const REQUEST_ID_HEADER = "X-Request-Id";
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{8,128}$/;
function normalizeRequestId(value) {
    if (!value) {
        return undefined;
    }
    const trimmed = value.trim();
    return REQUEST_ID_PATTERN.test(trimmed) ? trimmed : undefined;
}
function requestIdMiddleware(req, res, next) {
    const requestId = normalizeRequestId(req.header(REQUEST_ID_HEADER)) ?? crypto_1.default.randomUUID();
    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    next();
}
