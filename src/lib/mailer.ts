import nodemailer from "nodemailer";
import { ApiError } from "./errors";

type VerificationEmailInput = {
  to: string;
  merchantName: string;
  verificationUrl: string;
};

type PasswordResetEmailInput = {
  to: string;
  merchantName: string;
  resetUrl: string;
};

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function smtpIsConfigured() {
  return Boolean(process.env.SMTP_HOST);
}

function createTransporter() {
  if (!smtpIsConfigured()) {
    if (isProduction()) {
      throw new ApiError(500, "SMTP is not configured for email delivery");
    }

    return null;
  }

  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: user && pass ? { user, pass } : undefined,
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[character] ?? character;
  });
}

export function buildMerchantVerificationUrl(email: string, token: string) {
  const baseUrl =
    process.env.EMAIL_VERIFICATION_BASE_URL ||
    process.env.APP_BASE_URL ||
    "http://localhost:5000";
  const url = new URL("/api/v1/merchants/verify-email", baseUrl);

  url.searchParams.set("email", email);
  url.searchParams.set("token", token);

  return url.toString();
}

export function buildMerchantPasswordResetUrl(email: string, token: string) {
  const baseUrl =
    process.env.PASSWORD_RESET_BASE_URL ||
    process.env.FRONTEND_BASE_URL ||
    process.env.APP_BASE_URL ||
    "http://localhost:5000";
  const url = new URL("/reset-password", baseUrl);

  url.searchParams.set("email", email);
  url.searchParams.set("token", token);

  return url.toString();
}

export async function sendMerchantVerificationEmail({
  to,
  merchantName,
  verificationUrl,
}: VerificationEmailInput) {
  const transporter = createTransporter();

  if (!transporter) {
    console.info("Merchant verification email not sent; SMTP is not configured.");
    console.info(`Verification link for ${to}: ${verificationUrl}`);
    return { sent: false };
  }

  const from = process.env.MAIL_FROM || process.env.SMTP_FROM;
  if (!from) {
    if (isProduction()) {
      throw new ApiError(500, "MAIL_FROM is required for email delivery");
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
  } catch (error) {
    if (isProduction()) {
      throw new ApiError(502, "Could not send merchant verification email");
    }

    console.warn("Merchant verification email failed; using development fallback.");
    console.warn(error);
    console.info(`Verification link for ${to}: ${verificationUrl}`);
    return { sent: false };
  }
}

export async function sendMerchantPasswordResetEmail({
  to,
  merchantName,
  resetUrl,
}: PasswordResetEmailInput) {
  const transporter = createTransporter();

  if (!transporter) {
    console.info("Merchant password reset email not sent; SMTP is not configured.");
    console.info(`Password reset link for ${to}: ${resetUrl}`);
    return { sent: false };
  }

  const from = process.env.MAIL_FROM || process.env.SMTP_FROM;
  if (!from) {
    if (isProduction()) {
      throw new ApiError(500, "MAIL_FROM is required for email delivery");
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
  } catch (error) {
    if (isProduction()) {
      throw new ApiError(502, "Could not send merchant password reset email");
    }

    console.warn("Merchant password reset email failed; using development fallback.");
    console.warn(error);
    console.info(`Password reset link for ${to}: ${resetUrl}`);
    return { sent: false };
  }
}
