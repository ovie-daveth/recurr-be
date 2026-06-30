import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { docsRouter } from "./docs/docs.routes";
import { errorMiddleware } from "./middlewares/error.middleware";
import {
  merchantApiRateLimit,
  publicRateLimit,
} from "./middlewares/rate-limit.middleware";
import { businessesRouter } from "./modules/businesses/businesses.routes";
import { customersRouter } from "./modules/customers/customers.routes";
import { merchantAuthRouter } from "./modules/merchant-auth/merchant-auth.routes";
import { plansRouter } from "./modules/plans/plans.routes";
import { webhooksRouter } from "./modules/webhooks/webhooks.routes";
import { sendSuccess } from "./lib/responses";

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
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

app.use("/api/docs", docsRouter);

app.use("/api/v1/merchants", merchantApiRateLimit, merchantAuthRouter);
app.use("/api/v1/businesses", merchantApiRateLimit, businessesRouter);
app.use("/api/v1/plans", merchantApiRateLimit, plansRouter);
app.use("/api/v1/customers", merchantApiRateLimit, customersRouter);

app.use(errorMiddleware);

export default app;
