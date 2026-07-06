import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { ApiError, requireMerchantUser } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { sendSuccess } from "../../lib/responses";
import { merchantSessionMiddleware } from "../../middlewares/merchant-session.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { runDueDunning } from "../dunning/dunning.service";
import { runDueDunningSchema } from "./dev-dunning.schema";

export const devDunningRouter = Router();

devDunningRouter.use(merchantSessionMiddleware);

async function requireDunningRunAccess(businessId: string, userId: string) {
  const membership = await prisma.businessMember.findFirst({
    where: {
      businessId,
      userId,
      role: { in: ["OWNER", "ADMIN", "DEVELOPER"] },
    },
  });

  if (!membership) {
    throw new ApiError(404, "Business not found", [], "BUSINESS_NOT_FOUND");
  }
}

devDunningRouter.post(
  "/run-due",
  validate({ body: runDueDunningSchema }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const input = req.body as typeof runDueDunningSchema._output;

    await requireDunningRunAccess(input.businessId, user.id);

    const result = await runDueDunning(input);

    sendSuccess(res, 200, "Due dunning run completed", result);
  })
);
