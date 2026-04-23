/**
 * JWT signing/verification. Tokens are HS256 signed with SESSION_SECRET.
 *
 * Token shape:
 *   { role: "company",   companyId:   string }
 *   { role: "applicant", applicantId: string }
 */

import jwt from "jsonwebtoken";

const TOKEN_TTL = "7d";

export type CompanyTokenPayload = { role: "company"; companyId: string };
export type ApplicantTokenPayload = { role: "applicant"; applicantId: string };
export type TokenPayload = CompanyTokenPayload | ApplicantTokenPayload;

function getSecret(): string {
  const s = process.env["SESSION_SECRET"] ?? process.env["JWT_SECRET"];
  if (!s) {
    throw new Error(
      "SESSION_SECRET (or JWT_SECRET) must be set to sign auth tokens.",
    );
  }
  return s;
}

export function signCompanyToken(companyId: string): string {
  const payload: CompanyTokenPayload = { role: "company", companyId };
  return jwt.sign(payload, getSecret(), { expiresIn: TOKEN_TTL });
}

export function signApplicantToken(applicantId: string): string {
  const payload: ApplicantTokenPayload = { role: "applicant", applicantId };
  return jwt.sign(payload, getSecret(), { expiresIn: TOKEN_TTL });
}

export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, getSecret());
  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("Malformed token payload");
  }
  const role = (decoded as { role?: unknown }).role;
  if (role === "company") {
    const companyId = (decoded as { companyId?: unknown }).companyId;
    if (typeof companyId !== "string") throw new Error("Malformed company token");
    return { role, companyId };
  }
  if (role === "applicant") {
    const applicantId = (decoded as { applicantId?: unknown }).applicantId;
    if (typeof applicantId !== "string") {
      throw new Error("Malformed applicant token");
    }
    return { role, applicantId };
  }
  throw new Error("Unknown token role");
}
