"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEmailDiagnostics = getEmailDiagnostics;
exports.buildMerchantVerificationUrl = buildMerchantVerificationUrl;
exports.buildMerchantPasswordResetUrl = buildMerchantPasswordResetUrl;
exports.sendMerchantVerificationEmail = sendMerchantVerificationEmail;
exports.sendMerchantPasswordResetEmail = sendMerchantPasswordResetEmail;
exports.sendAdminMessage = sendAdminMessage;
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
function maskValue(value) {
    if (!value) {
        return null;
    }
    if (value.length <= 4) {
        return "****";
    }
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
}
async function getEmailDiagnostics(input = {}) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    const configured = {
        smtpHost: process.env.SMTP_HOST ?? null,
        smtpPort: port,
        smtpSecure: process.env.SMTP_SECURE === "true" || port === 465,
        smtpUserConfigured: Boolean(process.env.SMTP_USER),
        smtpUserPreview: maskValue(process.env.SMTP_USER),
        smtpPassConfigured: Boolean(process.env.SMTP_PASS),
        mailFromConfigured: Boolean(process.env.MAIL_FROM || process.env.SMTP_FROM),
        mailFrom: process.env.MAIL_FROM || process.env.SMTP_FROM || null,
        emailVerificationBaseUrl: process.env.EMAIL_VERIFICATION_BASE_URL ||
            process.env.FRONTEND_BASE_URL ||
            process.env.APP_BASE_URL ||
            null,
    };
    if (!input.verifyConnection) {
        return {
            configured,
            connection: { verified: null, error: null },
        };
    }
    try {
        const transporter = createTransporter();
        if (!transporter) {
            return {
                configured,
                connection: {
                    verified: false,
                    error: "SMTP is not configured",
                },
            };
        }
        await transporter.verify();
        return {
            configured,
            connection: { verified: true, error: null },
        };
    }
    catch (error) {
        logEmailDeliveryError("SMTP diagnostics verification failed", error);
        return {
            configured,
            connection: {
                verified: false,
                error: error instanceof Error
                    ? {
                        name: error.name,
                        message: error.message,
                        code: error.code,
                        command: error.command,
                        responseCode: error.responseCode,
                        response: error.response,
                    }
                    : "SMTP verification failed",
            },
        };
    }
}
function logEmailDeliveryError(context, error) {
    if (error instanceof Error) {
        console.error(context, {
            name: error.name,
            message: error.message,
            code: error.code,
            command: error.command,
            responseCode: error.responseCode,
            response: error.response,
        });
        return;
    }
    console.error(context, error);
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
        logEmailDeliveryError("Merchant verification email delivery failed", error);
        if (isProduction()) {
            throw new errors_1.ApiError(502, "Could not send merchant verification email");
        }
        console.warn("Merchant verification email failed; using development fallback.");
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
        logEmailDeliveryError("Merchant password reset email delivery failed", error);
        if (isProduction()) {
            throw new errors_1.ApiError(502, "Could not send merchant password reset email");
        }
        console.warn("Merchant password reset email failed; using development fallback.");
        console.info(`Password reset link for ${to}: ${resetUrl}`);
        return { sent: false };
    }
}
async function sendAdminMessage({ to, merchantName, subject, message, }) {
    const transporter = createTransporter();
    const from = process.env.MAIL_FROM || process.env.SMTP_FROM;
    if (!transporter || !from) {
        throw new errors_1.ApiError(503, "SMTP and MAIL_FROM must be configured before sending admin email");
    }
    const safeMerchantName = escapeHtml(merchantName);
    const safeMessage = escapeHtml(message).replace(/\r?\n/g, "<br>");
    try {
        await transporter.sendMail({
            from,
            to,
            subject,
            text: [`Hi ${merchantName},`, "", message].join("\n"),
            html: `<p>Hi ${safeMerchantName},</p><p>${safeMessage}</p>`,
        });
    }
    catch (error) {
        logEmailDeliveryError("Admin merchant email delivery failed", error);
        throw new errors_1.ApiError(502, "Could not send email to merchant");
    }
    return { sent: true };
}
