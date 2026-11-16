"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const dev_payment_load_schema_1 = require("./dev-payment-load.schema");
(0, node_test_1.default)("mock load request defaults to the demo charge amount", () => {
    const parsed = dev_payment_load_schema_1.simulateMockLoadSchema.safeParse({
        businessId: "b321cc40-7c7b-4df8-a3b6-7ebdf0547638",
        paymentMethodId: "88feb767-5598-4f67-a934-4d6d7bf27b3e",
    });
    strict_1.default.equal(parsed.success, true);
    if (parsed.success) {
        strict_1.default.equal(parsed.data.amountMinor, 500_000);
    }
});
(0, node_test_1.default)("mock load request rejects invalid amounts", () => {
    const parsed = dev_payment_load_schema_1.simulateMockLoadSchema.safeParse({
        businessId: "b321cc40-7c7b-4df8-a3b6-7ebdf0547638",
        paymentMethodId: "88feb767-5598-4f67-a934-4d6d7bf27b3e",
        amountMinor: -1,
    });
    strict_1.default.equal(parsed.success, false);
});
