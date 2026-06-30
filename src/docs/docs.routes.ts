import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import { openApiDocument } from "./openapi";

export const docsRouter = Router();

docsRouter.get("/openapi.json", (_req, res) => {
  res.status(200).json(openApiDocument);
});

docsRouter.use("/", swaggerUi.serve, swaggerUi.setup(openApiDocument));
