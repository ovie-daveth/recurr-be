"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.merchantSessionMiddleware = merchantSessionMiddleware;
const api_keys_1 = require("../lib/api-keys");
const errors_1 = require("../lib/errors");
const prisma_1 = require("../lib/prisma");
const sessions_1 = require("../lib/sessions");
async function merchantSessionMiddleware(req, _res, next) {
    try {
        const token = (0, api_keys_1.extractBearerToken)(req.header("authorization"));
        if (!token) {
            throw new errors_1.ApiError(401, "Missing bearer session token");
        }
        const payload = (0, sessions_1.verifyMerchantSessionToken)(token);
        const user = await prisma_1.prisma.merchantUser.findUnique({
            where: { id: payload.sub },
        });
        if (!user || user.status !== "ACTIVE") {
            throw new errors_1.ApiError(401, "Invalid merchant session");
        }
        req.merchantUser = {
            id: user.id,
            email: user.email,
            name: user.name,
            passwordHash: user.passwordHash,
            status: user.status,
            emailVerifiedAt: user.emailVerifiedAt,
            verificationTokenHash: user.verificationTokenHash,
            verificationSentAt: user.verificationSentAt,
            lastLoginAt: user.lastLoginAt,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        };
        next();
    }
    catch (error) {
        next(error instanceof errors_1.ApiError ? error : new errors_1.ApiError(401, "Invalid merchant session"));
    }
}
