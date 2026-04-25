/**
 * JWT signing/verification. Tokens are HS256 signed with SESSION_SECRET.
 *
 * Token shape:
 *   { role: "company",   companyId:   string }
 *   { role: "applicant", applicantId: string }
 */

import jwt from "jsonwebtoken";
import { config } from "../lib/config";

import { UnauthorizedError } from "../lib/errors";

const TOKEN_TTL = "7d";
const secret: jwt.Secret = String(config.sessionSecret);

export type CompanyTokenPayload = { role: "company"; companyId: string };
export type ApplicantTokenPayload = { role: "applicant"; applicantId: string };
export type TokenPayload = CompanyTokenPayload | ApplicantTokenPayload;

export function signCompanyToken(companyId: string): string {
  const payload: CompanyTokenPayload = { role: "company", companyId };
  return jwt.sign(payload, secret, { expiresIn: TOKEN_TTL });
}

export function signApplicantToken(applicantId: string): string {
  const payload: ApplicantTokenPayload = { role: "applicant", applicantId };
  return jwt.sign(payload, secret, { expiresIn: TOKEN_TTL });
}

export function verifyToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, secret);
    if (typeof decoded !== "object" || decoded === null) {
      throw new UnauthorizedError("Malformed token payload");
    }
    const role = (decoded as { role?: unknown }).role;
    if (role === "company") {
      const companyId = (decoded as { companyId?: unknown }).companyId;
      if (typeof companyId !== "string") throw new UnauthorizedError("Malformed company token");
      return { role, companyId };
    }
    if (role === "applicant") {
      const applicantId = (decoded as { applicantId?: unknown }).applicantId;
      if (typeof applicantId !== "string") {
        throw new UnauthorizedError("Malformed applicant token");
      }
      return { role, applicantId };
    }
    throw new UnauthorizedError("Unknown token role");
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError("Invalid or expired token");
  }
}
