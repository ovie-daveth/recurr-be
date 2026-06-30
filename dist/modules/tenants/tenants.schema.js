"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTenantSchema = void 0;
const zod_1 = require("zod");
exports.createTenantSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2),
    email: zod_1.z.email().toLowerCase(),
    apiKeyName: zod_1.z.string().trim().min(2).default("Default API key"),
});
