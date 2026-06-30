"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const customers_routes_js_1 = require("./modules/customers/customers.routes.js");
const plans_routes_js_1 = require("./modules/plans/plans.routes.js");
const tenants_routes_js_1 = require("./modules/tenants/tenants.routes.js");
const error_middleware_js_1 = require("./middlewares/error.middleware.js");
const app = (0, express_1.default)();
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)());
app.use((0, morgan_1.default)("dev"));
app.use(express_1.default.json());
app.get("/health", (_req, res) => {
    res.status(200).json({
        status: "ok",
        service: "recurr-backend",
    });
});
// app.get("/health/db", async (_req, res) => {
//   const record = await prisma.healthCheck.create({
//     data: {
//       name: "database-connected",
//     },
//   });
//   res.status(200).json({
//     status: "ok",
//     database: "connected",
//     record,
//   });
// });
app.post("/api/v1/webhooks/nomba", (req, res) => {
    console.log("Nomba webhook received:", req.body);
    res.status(200).json({
        received: true,
    });
});
app.use("/api/v1/tenants", tenants_routes_js_1.tenantsRouter);
app.use("/api/v1/plans", plans_routes_js_1.plansRouter);
app.use("/api/v1/customers", customers_routes_js_1.customersRouter);
app.use(error_middleware_js_1.errorMiddleware);
exports.default = app;
