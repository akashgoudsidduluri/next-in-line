/**
 * Centralised error handler — every typed error maps to its HTTP status,
 * Zod errors map to 400, and unknown errors map to 500.
 */

import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { HttpError, toHttpError } from "../lib/errors";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Zod validation errors → 400
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Invalid request body",
      code: "VALIDATION_ERROR",
      issues: err.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }

  const httpErr: HttpError = err instanceof HttpError ? err : toHttpError(err);

  if (httpErr.status >= 500) {
    req.log?.error({ err }, "Request failed");
  } else {
    req.log?.warn({ err: { message: httpErr.message, code: httpErr.code } }, "Request rejected");
  }

  res.status(httpErr.status).json({
    error: httpErr.message,
    code: httpErr.code,
  });
};
