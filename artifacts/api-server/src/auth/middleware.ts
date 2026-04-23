/**
 * Auth middleware — `requireCompany` and `requireApplicant`.
 *
 * Both expect an `Authorization: Bearer <token>` header. They:
 *   1. Reject (401) when the header is missing or the token is invalid.
 *   2. Reject (403) when the token is valid but for the wrong role.
 *   3. Attach the decoded identity to `req.auth` on success.
 */

import type { Request, Response, NextFunction } from "express";
import {
  verifyToken,
  type CompanyTokenPayload,
  type ApplicantTokenPayload,
} from "./jwt";
import { UnauthorizedError, ForbiddenError } from "../lib/errors";

type AuthedRequest = Request & {
  auth?: CompanyTokenPayload | ApplicantTokenPayload;
};

function extractBearer(req: Request): string {
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing bearer token");
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) throw new UnauthorizedError("Empty bearer token");
  return token;
}

export function requireCompany(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  try {
    const token = extractBearer(req);
    const payload = verifyToken(token);
    if (payload.role !== "company") {
      throw new ForbiddenError("Company token required");
    }
    (req as AuthedRequest).auth = payload;
    next();
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      next(err);
      return;
    }
    next(new UnauthorizedError("Invalid token"));
  }
}

export function requireApplicant(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  try {
    const token = extractBearer(req);
    const payload = verifyToken(token);
    if (payload.role !== "applicant") {
      throw new ForbiddenError("Applicant token required");
    }
    (req as AuthedRequest).auth = payload;
    next();
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      next(err);
      return;
    }
    next(new UnauthorizedError("Invalid token"));
  }
}

export function getCompanyAuth(req: Request): CompanyTokenPayload {
  const auth = (req as AuthedRequest).auth;
  if (!auth || auth.role !== "company") {
    throw new UnauthorizedError("Company auth required");
  }
  return auth;
}

export function getApplicantAuth(req: Request): ApplicantTokenPayload {
  const auth = (req as AuthedRequest).auth;
  if (!auth || auth.role !== "applicant") {
    throw new UnauthorizedError("Applicant auth required");
  }
  return auth;
}
