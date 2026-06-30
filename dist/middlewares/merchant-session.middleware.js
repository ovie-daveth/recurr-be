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
        const session = await prisma_1.prisma.merchantSession.findUnique({
            where: { id: payload.sid },
            include: { user: true },
        });
        if (!session ||
            session.userId !== payload.sub ||
            session.revokedAt ||
            session.expiresAt <= new Date()) {
            throw new errors_1.ApiError(401, "Invalid merchant session");
        }
        await prisma_1.prisma.merchantSession.update({
            where: { id: session.id },
            data: { lastUsedAt: new Date() },
        });
        const activeUser = await prisma_1.prisma.merchantUser.findUnique({
            where: { id: payload.sub },
        });
        if (!activeUser || activeUser.status !== "ACTIVE") {
            throw new errors_1.ApiError(401, "Invalid merchant session");
        }
        req.merchantUser = {
            id: activeUser.id,
            email: activeUser.email,
            name: activeUser.name,
            passwordHash: activeUser.passwordHash,
            status: activeUser.status,
            emailVerifiedAt: activeUser.emailVerifiedAt,
            verificationTokenHash: activeUser.verificationTokenHash,
            verificationSentAt: activeUser.verificationSentAt,
            lastLoginAt: activeUser.lastLoginAt,
            createdAt: activeUser.createdAt,
            updatedAt: activeUser.updatedAt,
        };
        req.merchantSession = session;
        next();
    }
    catch (error) {
        next(error instanceof errors_1.ApiError ? error : new errors_1.ApiError(401, "Invalid merchant session"));
    }
}
