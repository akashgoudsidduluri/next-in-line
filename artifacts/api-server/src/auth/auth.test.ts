import { describe, it, expect, vi } from "vitest";
import jwt from "jsonwebtoken";
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
    const token = signCompanyToken("c-1");
    const decoded = verifyToken(token);
    expect(decoded).toMatchObject({ role: "company", companyId: "c-1" });
  });

  it("signs and verifies an applicant token round-trip", () => {
    const token = signApplicantToken("a-1");
    const decoded = verifyToken(token);
    expect(decoded).toMatchObject({ role: "applicant", applicantId: "a-1" });
  });

  it("throws on a tampered token", () => {
    const token = signCompanyToken("c-1") + "x";
    expect(() => verifyToken(token)).toThrow();
  });
});

describe("auth/middleware", () => {
  it("requireCompany rejects missing token with 401", async () => {
    const { err } = runMiddleware(requireCompany, fakeReq());
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect((err as UnauthorizedError).status).toBe(401);
  });

  it("requireApplicant rejects missing token with 401", async () => {
    const { err } = runMiddleware(requireApplicant, fakeReq());
    expect(err).toBeInstanceOf(UnauthorizedError);
  });

  it("requireCompany rejects an applicant token with 403", () => {
    const token = signApplicantToken("a-9");
    const { err } = runMiddleware(
      requireCompany,
      fakeReq({ authorization: `Bearer ${token}` }),
    );
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it("requireApplicant rejects a company token with 403", () => {
    const token = signCompanyToken("c-9");
    const { err } = runMiddleware(
      requireApplicant,
      fakeReq({ authorization: `Bearer ${token}` }),
    );
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it("requireCompany attaches identity on success", () => {
    const token = signCompanyToken("c-42");
    const req = fakeReq({ authorization: `Bearer ${token}` });
    const { err } = runMiddleware(requireCompany, req);
    expect(err).toBeUndefined();
    expect(req.auth).toMatchObject({ role: "company", companyId: "c-42" });
  });

  it("requireApplicant attaches identity on success", () => {
    const token = signApplicantToken("a-42");
    const req = fakeReq({ authorization: `Bearer ${token}` });
    const { err } = runMiddleware(requireApplicant, req);
    expect(err).toBeUndefined();
    expect(req.auth).toMatchObject({ role: "applicant", applicantId: "a-42" });
  });

  it("rejects malformed authorization header with 401", () => {
    const { err } = runMiddleware(
      requireCompany,
      fakeReq({ authorization: "NotBearer xxx" }),
    );
    expect(err).toBeInstanceOf(UnauthorizedError);
  });

  // Belt-and-braces: a token that decodes to no role is a 401.
  it("rejects a token with an unknown role as 401", () => {
    const { signCompanyToken: _ } = { signCompanyToken };
    const spy = vi.spyOn(Date, "now");
    spy.mockRestore();
    const bogus = jwt.sign({ role: "weird" }, "temp-secret");
    const { err } = runMiddleware(
      requireCompany,
      fakeReq({ authorization: `Bearer ${bogus}` }),
    );
    expect(err).toBeInstanceOf(UnauthorizedError);
  });
});
