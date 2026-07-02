import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { docsRouter } from "./docs/docs.routes";
import { errorMiddleware } from "./middlewares/error.middleware";
import { requestIdMiddleware } from "./middlewares/request-id.middleware";
import {
  merchantApiRateLimit,
  publicRateLimit,
} from "./middlewares/rate-limit.middleware";
import { businessesRouter } from "./modules/businesses/businesses.routes";
import { customersRouter } from "./modules/customers/customers.routes";
import { invoicesRouter } from "./modules/invoices/invoices.routes";
import { merchantAuthRouter } from "./modules/merchant-auth/merchant-auth.routes";
import { paymentAttemptsRouter } from "./modules/payment-attempts/payment-attempts.routes";
import { paymentMethodsRouter } from "./modules/payment-methods/payment-methods.routes";
import { plansRouter } from "./modules/plans/plans.routes";
import { subscriptionsRouter } from "./modules/subscriptions/subscriptions.routes";
import { webhooksRouter } from "./modules/webhooks/webhooks.routes";
import { sendSuccess } from "./lib/responses";
import { devBillingRouter } from "./modules/dev/dev-billing.routes";
import { devWebhooksRouter } from "./modules/dev/dev-webhooks.routes";
import { getEmailDiagnostics } from "./lib/mailer";

const app = express();

app.set("trust proxy", 1);

app.use(requestIdMiddleware);
app.use(helmet());
app.use(cors());
morgan.token("request-id", (req) => {
  return (req as typeof req & { requestId?: string }).requestId ?? "-";
});
app.use(
  morgan(
    ":method :url :status :response-time ms - :res[content-length] requestId=:request-id"
  )
);
app.use(publicRateLimit);
app.use(
  "/api/v1/webhooks",
  express.raw({ type: "application/json", limit: "1mb" }),
  webhooksRouter
);
app.use(express.json());

app.get("/health", (_req, res) => {
  sendSuccess(res, 200, "Service is reachable", {
    status: "ok",
    service: "recurr-backend",
  });
});

app.get("/health/email", async (req, res) => {
  const diagnostics = await getEmailDiagnostics({
    verifyConnection: req.query.verify === "true",
  });

  sendSuccess(res, 200, "Email diagnostics returned", diagnostics);
});

app.use("/api/docs", docsRouter);

app.use("/api/v1/dev/billing", devBillingRouter);
app.use("/api/v1/dev/webhooks", devWebhooksRouter);
app.use("/api/v1/merchants", merchantApiRateLimit, merchantAuthRouter);
app.use("/api/v1/businesses", merchantApiRateLimit, businessesRouter);
app.use("/api/v1/plans", merchantApiRateLimit, plansRouter);
app.use("/api/v1/subscriptions", merchantApiRateLimit, subscriptionsRouter);
app.use("/api/v1/invoices", merchantApiRateLimit, invoicesRouter);
app.use("/api/v1/payment-attempts", merchantApiRateLimit, paymentAttemptsRouter);
app.use("/api/v1/customers", merchantApiRateLimit, paymentMethodsRouter);
app.use("/api/v1/customers", merchantApiRateLimit, customersRouter);

app.use(errorMiddleware);

export default app;
