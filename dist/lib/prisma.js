"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
require("dotenv/config");
const client_1 = require("../generated/prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to initialize Prisma");
}
const adapter = new adapter_pg_1.PrismaPg({
    connectionString: process.env.DATABASE_URL,
});
exports.prisma = new client_1.PrismaClient({
    adapter,
});
