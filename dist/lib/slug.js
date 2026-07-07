"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.slugify = slugify;
exports.generateUniqueBusinessSlug = generateUniqueBusinessSlug;
const prisma_1 = require("./prisma");
const crypto_1 = __importDefault(require("crypto"));
function slugify(value) {
    const slug = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return slug || "business";
}
async function generateUniqueBusinessSlug(name) {
    const base = slugify(name);
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
        const slug = `${base}${suffix}`;
        const existing = await prisma_1.prisma.business.findUnique({ where: { slug } });
        if (!existing) {
            return slug;
        }
    }
    return `${base}-${cryptoRandomSuffix()}`;
}
function cryptoRandomSuffix() {
    return crypto_1.default.randomBytes(4).toString("hex");
}
