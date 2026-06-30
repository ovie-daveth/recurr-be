import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { docsRouter } from "./docs/docs.routes";
import { errorMiddleware } from "./middlewares/error.middleware";
import {
  merchantApiRateLimit,
  publicRateLimit,
  tenantOnboardingRateLimit,
} from "./middlewares/rate-limit.middleware";
import { apiKeysRouter } from "./modules/api-keys/api-keys.routes";
import { customersRouter } from "./modules/customers/customers.routes";
import { plansRouter } from "./modules/plans/plans.routes";
import { tenantsRouter } from "./modules/tenants/tenants.routes";

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());
app.use(publicRateLimit);

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "recurr-backend",
  });
});

app.use("/api/docs", docsRouter);

app.post("/api/v1/webhooks/nomba", (req, res) => {
  console.log("Nomba webhook received:", req.body);

  res.status(200).json({
    received: true,
  });
});

app.use("/api/v1/tenants", tenantOnboardingRateLimit, tenantsRouter);
app.use("/api/v1/api-keys", merchantApiRateLimit, apiKeysRouter);
app.use("/api/v1/plans", merchantApiRateLimit, plansRouter);
app.use("/api/v1/customers", merchantApiRateLimit, customersRouter);

app.use(errorMiddleware);

export default app;
