import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { ApiError, requireMerchantUser } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { sendSuccess } from "../../lib/responses";
import { merchantSessionMiddleware } from "../../middlewares/merchant-session.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { runCleanup } from "../cleanup/cleanup.service";
import { runCleanupSchema } from "./dev-cleanup.schema";

export const devCleanupRouter = Router();

devCleanupRouter.use(merchantSessionMiddleware);

async function requireCleanupAccess(businessId: string | undefined, userId: string) {
  if (!businessId) {
    return;
  }

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

devCleanupRouter.post(
  "/run",
  validate({ body: runCleanupSchema }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const input = req.body as typeof runCleanupSchema._output;

    await requireCleanupAccess(input.businessId, user.id);
    const result = await runCleanup(input);

    sendSuccess(res, 200, "Cleanup completed", result);
  })
);
