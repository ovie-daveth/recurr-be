import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { ApiError } from "../../lib/errors";
import { sendSuccess } from "../../lib/responses";
import { validate } from "../../middlewares/validate.middleware";
import { runDueBilling } from "../billing/billing.service";
import { runDueBillingSchema } from "./dev-billing.schema";

export const devBillingRouter = Router();

devBillingRouter.use((req, _res, next) => {
  if (process.env.NODE_ENV === "production") {
    next(new ApiError(404, "Not found"));
    return;
  }

  next();
});

devBillingRouter.post(
  "/run-due",
  validate({ body: runDueBillingSchema }),
  asyncHandler(async (req, res) => {
    const result = await runDueBilling(req.body);
    sendSuccess(res, 200, "Due billing run completed", result);
  })
);
