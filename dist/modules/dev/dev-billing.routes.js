"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.devBillingRouter = void 0;
const express_1 = require("express");
const async_handler_1 = require("../../lib/async-handler");
const errors_1 = require("../../lib/errors");
const responses_1 = require("../../lib/responses");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const billing_service_1 = require("../billing/billing.service");
const dev_billing_schema_1 = require("./dev-billing.schema");
exports.devBillingRouter = (0, express_1.Router)();
exports.devBillingRouter.use((req, _res, next) => {
    if (process.env.NODE_ENV === "production") {
        next(new errors_1.ApiError(404, "Not found"));
        return;
    }
    next();
});
exports.devBillingRouter.post("/run-due", (0, validate_middleware_1.validate)({ body: dev_billing_schema_1.runDueBillingSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const result = await (0, billing_service_1.runDueBilling)(req.body);
    (0, responses_1.sendSuccess)(res, 200, "Due billing run completed", result);
}));
