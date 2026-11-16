"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const admin_schema_1 = require("./admin.schema");
(0, node_test_1.default)("admin email accepts a bounded subject and plain-text message", () => {
    const parsed = admin_schema_1.adminEmailSchema.safeParse({
        subject: "Account update",
        message: "Please contact support.",
    });
    strict_1.default.equal(parsed.success, true);
});
(0, node_test_1.default)("admin email rejects header newlines in the subject", () => {
    const parsed = admin_schema_1.adminEmailSchema.safeParse({
        subject: "Account update\r\nBcc: attacker@example.test",
        message: "Please contact support.",
    });
    strict_1.default.equal(parsed.success, false);
});
