import rateLimit, { ipKeyGenerator } from "express-rate-limit";

export const publicRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests, please try again later",
  },
});

export const merchantSignupRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many merchant signup attempts, please try again later",
  },
});

export const merchantApiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const authorization = req.header("authorization");
    if (authorization) {
      return authorization;
    }

    return ipKeyGenerator(req.ip || "unknown");
  },
  message: {
    error: "Too many API requests, please slow down",
  },
});
