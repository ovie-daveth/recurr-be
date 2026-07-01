import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

type ValidationSchemas = {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
};

export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (schemas.body) {
      req.body = schemas.body.parse(req.body);
    }

    if (schemas.params) {
      req.params = schemas.params.parse(req.params) as typeof req.params;
    }

    if (schemas.query) {
      req.validatedQuery = schemas.query.parse(req.query);
    }

    next();
  };
}
