import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { customersRouter } from "./modules/customers/customers.routes.js";
import { plansRouter } from "./modules/plans/plans.routes.js";
import { tenantsRouter } from "./modules/tenants/tenants.routes.js";
import { errorMiddleware } from "./middlewares/error.middleware.js";

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

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

app.use("/api/v1/tenants", tenantsRouter);
app.use("/api/v1/plans", plansRouter);
app.use("/api/v1/customers", customersRouter);

app.use(errorMiddleware);

export default app;
