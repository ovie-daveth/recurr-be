"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMerchantVerificationUrl = buildMerchantVerificationUrl;
exports.buildMerchantPasswordResetUrl = buildMerchantPasswordResetUrl;
exports.sendMerchantVerificationEmail = sendMerchantVerificationEmail;
exports.sendMerchantPasswordResetEmail = sendMerchantPasswordResetEmail;
const nodemailer_1 = __importDefault(require("nodemailer"));
const errors_1 = require("./errors");
function isProduction() {
    return process.env.NODE_ENV === "production";
}
function smtpIsConfigured() {
    return Boolean(process.env.SMTP_HOST);
}
function createTransporter() {
    if (!smtpIsConfigured()) {
        if (isProduction()) {
            throw new errors_1.ApiError(500, "SMTP is not configured for email delivery");
        }
        return null;
    }
    const port = Number(process.env.SMTP_PORT ?? 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    return nodemailer_1.default.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: process.env.SMTP_SECURE === "true" || port === 465,
        auth: user && pass ? { user, pass } : undefined,
    });
}
function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => {
        const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
        };
        return entities[character] ?? character;
    });
}
function buildMerchantVerificationUrl(email, token) {
    const baseUrl = process.env.EMAIL_VERIFICATION_BASE_URL ||
        process.env.FRONTEND_BASE_URL ||
        process.env.APP_BASE_URL ||
        "http://localhost:5173";
    const url = new URL("/verify-email", baseUrl);
    url.searchParams.set("email", email);
    url.searchParams.set("token", token);
    return url.toString();
}
function buildMerchantPasswordResetUrl(email, token) {
    const baseUrl = process.env.PASSWORD_RESET_BASE_URL ||
        process.env.FRONTEND_BASE_URL ||
        process.env.APP_BASE_URL ||
        "http://localhost:5000";
    const url = new URL("/reset-password", baseUrl);
    url.searchParams.set("email", email);
    url.searchParams.set("token", token);
    return url.toString();
}
async function sendMerchantVerificationEmail({ to, merchantName, verificationUrl, }) {
    const transporter = createTransporter();
    if (!transporter) {
        console.info("Merchant verification email not sent; SMTP is not configured.");
        console.info(`Verification link for ${to}: ${verificationUrl}`);
        return { sent: false };
    }
    const from = process.env.MAIL_FROM || process.env.SMTP_FROM;
    if (!from) {
        if (isProduction()) {
            throw new errors_1.ApiError(500, "MAIL_FROM is required for email delivery");
        }
        console.info("Merchant verification email not sent; MAIL_FROM is not configured.");
        console.info(`Verification link for ${to}: ${verificationUrl}`);
        return { sent: false };
    }
    try {
        const safeMerchantName = escapeHtml(merchantName);
        const safeVerificationUrl = escapeHtml(verificationUrl);
        await transporter.sendMail({
            from,
            to,
            subject: "Verify your Recurr merchant account",
            text: [
                `Hi ${merchantName},`,
                "",
                "Verify your Recurr merchant account by opening this link:",
                verificationUrl,
                "",
                "If you did not create this account, ignore this email.",
            ].join("\n"),
            html: `
        <p>Hi ${safeMerchantName},</p>
        <p>Verify your Recurr merchant account by opening this link:</p>
        <p><a href="${safeVerificationUrl}">Verify merchant email</a></p>
        <p>If you did not create this account, ignore this email.</p>
      `,
        });
        return { sent: true };
    }
    catch (error) {
        if (isProduction()) {
            throw new errors_1.ApiError(502, "Could not send merchant verification email");
        }
        console.warn("Merchant verification email failed; using development fallback.");
        console.warn(error);
        console.info(`Verification link for ${to}: ${verificationUrl}`);
        return { sent: false };
    }
}
async function sendMerchantPasswordResetEmail({ to, merchantName, resetUrl, }) {
    const transporter = createTransporter();
    if (!transporter) {
        console.info("Merchant password reset email not sent; SMTP is not configured.");
        console.info(`Password reset link for ${to}: ${resetUrl}`);
        return { sent: false };
    }
    const from = process.env.MAIL_FROM || process.env.SMTP_FROM;
    if (!from) {
        if (isProduction()) {
            throw new errors_1.ApiError(500, "MAIL_FROM is required for email delivery");
        }
        console.info("Merchant password reset email not sent; MAIL_FROM is not configured.");
        console.info(`Password reset link for ${to}: ${resetUrl}`);
        return { sent: false };
    }
    try {
        const safeMerchantName = escapeHtml(merchantName);
        const safeResetUrl = escapeHtml(resetUrl);
        await transporter.sendMail({
            from,
            to,
            subject: "Reset your Recurr merchant password",
            text: [
                `Hi ${merchantName},`,
                "",
                "Reset your Recurr merchant password by opening this link:",
                resetUrl,
                "",
                "This link expires soon and can only be used once.",
                "If you did not request this reset, ignore this email.",
            ].join("\n"),
            html: `
        <p>Hi ${safeMerchantName},</p>
        <p>Reset your Recurr merchant password by opening this link:</p>
        <p><a href="${safeResetUrl}">Reset merchant password</a></p>
        <p>This link expires soon and can only be used once.</p>
        <p>If you did not request this reset, ignore this email.</p>
      `,
        });
        return { sent: true };
    }
    catch (error) {
        if (isProduction()) {
            throw new errors_1.ApiError(502, "Could not send merchant password reset email");
        }
        console.warn("Merchant password reset email failed; using development fallback.");
        console.warn(error);
        console.info(`Password reset link for ${to}: ${resetUrl}`);
        return { sent: false };
    }
}
