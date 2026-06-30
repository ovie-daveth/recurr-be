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
const rate_limit_middleware_1 = require("./middlewares/rate-limit.middleware");
const businesses_routes_1 = require("./modules/businesses/businesses.routes");
const customers_routes_1 = require("./modules/customers/customers.routes");
const merchant_auth_routes_1 = require("./modules/merchant-auth/merchant-auth.routes");
const plans_routes_1 = require("./modules/plans/plans.routes");
const webhooks_routes_1 = require("./modules/webhooks/webhooks.routes");
const responses_1 = require("./lib/responses");
const app = (0, express_1.default)();
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)());
app.use((0, morgan_1.default)("dev"));
app.use(rate_limit_middleware_1.publicRateLimit);
app.use("/api/v1/webhooks", express_1.default.raw({ type: "application/json", limit: "1mb" }), webhooks_routes_1.webhooksRouter);
app.use(express_1.default.json());
app.get("/health", (_req, res) => {
    (0, responses_1.sendSuccess)(res, 200, "Service is reachable", {
        status: "ok",
        service: "recurr-backend",
    });
});
app.use("/api/docs", docs_routes_1.docsRouter);
app.use("/api/v1/merchants", rate_limit_middleware_1.merchantApiRateLimit, merchant_auth_routes_1.merchantAuthRouter);
app.use("/api/v1/businesses", rate_limit_middleware_1.merchantApiRateLimit, businesses_routes_1.businessesRouter);
app.use("/api/v1/plans", rate_limit_middleware_1.merchantApiRateLimit, plans_routes_1.plansRouter);
app.use("/api/v1/customers", rate_limit_middleware_1.merchantApiRateLimit, customers_routes_1.customersRouter);
app.use(error_middleware_1.errorMiddleware);
exports.default = app;
