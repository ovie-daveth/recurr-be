"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
const crypto_1 = __importDefault(require("crypto"));
const util_1 = require("util");
const scrypt = (0, util_1.promisify)(crypto_1.default.scrypt);
const KEY_LENGTH = 64;
async function hashPassword(password) {
    const salt = crypto_1.default.randomBytes(16).toString("base64url");
    const derivedKey = (await scrypt(password, salt, KEY_LENGTH));
    return `scrypt:${salt}:${derivedKey.toString("base64url")}`;
}
async function verifyPassword(password, passwordHash) {
    const [scheme, salt, storedKey] = passwordHash.split(":");
    if (scheme !== "scrypt" || !salt || !storedKey) {
        return false;
    }
    const derivedKey = (await scrypt(password, salt, KEY_LENGTH));
    const storedBuffer = Buffer.from(storedKey, "base64url");
    if (storedBuffer.length !== derivedKey.length) {
        return false;
    }
    return crypto_1.default.timingSafeEqual(storedBuffer, derivedKey);
}
