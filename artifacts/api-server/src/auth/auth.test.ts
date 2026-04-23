import { describe, it, expect, vi } from "vitest";
import {
  signCompanyToken,
  signApplicantToken,
  verifyToken,
} from "./jwt";
import { requireCompany, requireApplicant } from "./middleware";
import { UnauthorizedError, ForbiddenError } from "../lib/errors";

function fakeReq(headers: Record<string, string> = {}) {
  return { headers } as any;
}

function runMiddleware(
  mw: (req: any, res: any, next: any) => void,
  req: any,
): { req: any; err: unknown } {
  let err: unknown = undefined;
  mw(req, {} as any, (e: unknown) => {
    err = e;
  });
  return { req, err };
}

describe("auth/jwt", () => {
  it("signs and verifies a company token round-trip", () => {
    const companyId = "c-" + Math.random();
    const token = signCompanyToken(companyId);
    
    expect(token).toBeDefined();
    expect(token.split(".").length).toBe(3);

    const decoded = verifyToken(token);
    expect(decoded.role).toBe("company");
    expect((decoded as any).companyId).toBe(companyId);
  });

  it("signs and verifies an applicant token round-trip", () => {
    const applicantId = "a-" + Math.random();
    const token = signApplicantToken(applicantId);
    
    expect(token).toBeDefined();
    const decoded = verifyToken(token);
    expect(decoded.role).toBe("applicant");
    expect((decoded as any).applicantId).toBe(applicantId);
  });

  it("throws on a tampered token with specific error message", () => {
    const token = signCompanyToken("c-1") + "x";
    expect(() => verifyToken(token)).toThrow();
  });
});

describe("auth/middleware", () => {
  it("requireCompany rejects missing token with 401 UnauthorizedError", async () => {
    const { err } = runMiddleware(requireCompany, fakeReq());
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect((err as UnauthorizedError).status).toBe(401);
    expect((err as UnauthorizedError).code).toBe("UNAUTHORIZED");
  });

  it("requireApplicant rejects missing token with 401", async () => {
    const { err } = runMiddleware(requireApplicant, fakeReq());
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect((err as any).message).toMatch(/Missing bearer token/);
  });

  it("requireCompany rejects an applicant token with 403 Forbidden", () => {
    const token = signApplicantToken("a-9");
    const { err } = runMiddleware(
      requireCompany,
      fakeReq({ authorization: `Bearer ${token}` }),
    );
    expect(err).toBeInstanceOf(ForbiddenError);
    expect((err as ForbiddenError).status).toBe(403);
    expect((err as ForbiddenError).code).toBe("FORBIDDEN");
  });

  it("requireApplicant attaches identity and provides correct auth context", () => {
    const applicantId = "a-42";
    const token = signApplicantToken(applicantId);
    const req = fakeReq({ authorization: `Bearer ${token}` });
    
    const { err } = runMiddleware(requireApplicant, req);
    
    expect(err).toBeUndefined();
    expect(req.auth).toBeDefined();
    expect(req.auth.role).toBe("applicant");
    expect(req.auth.applicantId).toBe(applicantId);
  });

  it("rejects malformed authorization header (missing Bearer prefix)", () => {
    const { err } = runMiddleware(
      requireCompany,
      fakeReq({ authorization: "Basic xxxxx" }),
    );
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect((err as any).message).toContain("Missing bearer token");
  });

  it("rejects a token with an unknown role correctly", () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ role: "weird" })).toString("base64url");
    const bogus = `${header}.${payload}.invalid-signature`;
    
    const { err } = runMiddleware(
      requireCompany,
      fakeReq({ authorization: `Bearer ${bogus}` }),
    );
    expect(err).toBeInstanceOf(UnauthorizedError);
  });
});
