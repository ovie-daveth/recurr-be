"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const docs_routes_1 = require("./docs/docs.routes");
const error_middleware_1 = require("./middlewares/error.middleware");
const request_id_middleware_1 = require("./middlewares/request-id.middleware");
const rate_limit_middleware_1 = require("./middlewares/rate-limit.middleware");
const businesses_routes_1 = require("./modules/businesses/businesses.routes");
const customers_routes_1 = require("./modules/customers/customers.routes");
const invoices_routes_1 = require("./modules/invoices/invoices.routes");
const merchant_auth_routes_1 = require("./modules/merchant-auth/merchant-auth.routes");
const payment_attempts_routes_1 = require("./modules/payment-attempts/payment-attempts.routes");
const payment_methods_routes_1 = require("./modules/payment-methods/payment-methods.routes");
const plans_routes_1 = require("./modules/plans/plans.routes");
const portal_routes_1 = require("./modules/portal/portal.routes");
const subscriptions_routes_1 = require("./modules/subscriptions/subscriptions.routes");
const webhooks_routes_1 = require("./modules/webhooks/webhooks.routes");
const responses_1 = require("./lib/responses");
const dev_billing_routes_1 = require("./modules/dev/dev-billing.routes");
const dev_cleanup_routes_1 = require("./modules/dev/dev-cleanup.routes");
const dev_dunning_routes_1 = require("./modules/dev/dev-dunning.routes");
const dev_webhooks_routes_1 = require("./modules/dev/dev-webhooks.routes");
const mailer_1 = require("./lib/mailer");
const dunning_policies_routes_1 = require("./modules/dunning-policies/dunning-policies.routes");
const observability_1 = require("./lib/observability");
const public_subscriptions_routes_1 = require("./modules/public-subscriptions/public-subscriptions.routes");
const app = (0, express_1.default)();
app.set("trust proxy", 1);
app.use(request_id_middleware_1.requestIdMiddleware);
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)());
morgan_1.default.token("request-id", (req) => {
    return req.requestId ?? "-";
});
app.use((0, morgan_1.default)(":method :url :status :response-time ms - :res[content-length] requestId=:request-id"));
app.use(rate_limit_middleware_1.publicRateLimit);
app.use("/api/v1/webhooks", express_1.default.raw({ type: "application/json", limit: "1mb" }), webhooks_routes_1.webhooksRouter);
app.use(express_1.default.json());
app.get("/health", (_req, res) => {
    (0, responses_1.sendSuccess)(res, 200, "Service is reachable", {
        status: "ok",
        service: "recurr-backend",
    });
});
app.get("/health/email", async (req, res) => {
    const diagnostics = await (0, mailer_1.getEmailDiagnostics)({
        verifyConnection: req.query.verify === "true",
    });
    (0, responses_1.sendSuccess)(res, 200, "Email diagnostics returned", diagnostics);
});
app.get("/health/metrics", (_req, res) => {
    (0, responses_1.sendSuccess)(res, 200, "Metrics returned", (0, observability_1.getMetricsSnapshot)());
});
app.use("/api/docs", docs_routes_1.docsRouter);
app.use("/api/v1/dev/billing", dev_billing_routes_1.devBillingRouter);
app.use("/api/v1/dev/cleanup", dev_cleanup_routes_1.devCleanupRouter);
app.use("/api/v1/dev/dunning", dev_dunning_routes_1.devDunningRouter);
app.use("/api/v1/dev/webhooks", dev_webhooks_routes_1.devWebhooksRouter);
app.use("/api/v1/public", public_subscriptions_routes_1.publicSubscriptionsRouter);
app.use("/api/v1/merchants", rate_limit_middleware_1.merchantApiRateLimit, merchant_auth_routes_1.merchantAuthRouter);
app.use("/api/v1/businesses", rate_limit_middleware_1.merchantApiRateLimit, businesses_routes_1.businessesRouter);
app.use("/api/v1/plans", rate_limit_middleware_1.merchantApiRateLimit, plans_routes_1.plansRouter);
app.use("/api/v1/subscriptions", rate_limit_middleware_1.merchantApiRateLimit, subscriptions_routes_1.subscriptionsRouter);
app.use("/api/v1/invoices", rate_limit_middleware_1.merchantApiRateLimit, invoices_routes_1.invoicesRouter);
app.use("/api/v1/dunning-policies", rate_limit_middleware_1.merchantApiRateLimit, dunning_policies_routes_1.dunningPoliciesRouter);
app.use("/api/v1/payment-attempts", rate_limit_middleware_1.merchantApiRateLimit, payment_attempts_routes_1.paymentAttemptsRouter);
app.use("/api/v1/portal", rate_limit_middleware_1.merchantApiRateLimit, portal_routes_1.portalRouter);
app.use("/api/v1/customers", rate_limit_middleware_1.merchantApiRateLimit, payment_methods_routes_1.paymentMethodsRouter);
app.use("/api/v1/customers", rate_limit_middleware_1.merchantApiRateLimit, customers_routes_1.customersRouter);
app.use(error_middleware_1.errorMiddleware);
exports.default = app;
