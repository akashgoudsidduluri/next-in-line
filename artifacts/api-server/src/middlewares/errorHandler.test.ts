import { describe, it, expect } from "vitest";
import { z } from "zod";
import { errorHandler } from "./errorHandler";
import {
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InvalidTransitionError,
  HttpError,
  toHttpError,
} from "../lib/errors";

function makeRes() {
  const captured: { status?: number; body?: unknown } = {};
  const res: any = {
    status(n: number) {
      captured.status = n;
      return res;
    },
    json(b: unknown) {
      captured.body = b;
      return res;
    },
  };
  const req: any = { log: { error() {}, warn() {} } };
  return { req, res, captured };
}

function runHandler(err: unknown) {
  const { req, res, captured } = makeRes();
  errorHandler(err, req, res, () => {});
  return captured;
}

describe("errorHandler", () => {
  it("maps each typed error to its HTTP status", () => {
    const cases: Array<[Error, number, string]> = [
      [new BadRequestError("bad"), 400, "BAD_REQUEST"],
      [new UnauthorizedError("nope"), 401, "UNAUTHORIZED"],
      [new ForbiddenError("nope"), 403, "FORBIDDEN"],
      [new NotFoundError("nope"), 404, "NOT_FOUND"],
      [new ConflictError("dup"), 409, "CONFLICT"],
      [new InvalidTransitionError("EXITED", "ACTIVE"), 409, "INVALID_TRANSITION"],
    ];
    for (const [err, status, code] of cases) {
      const out = runHandler(err);
      expect(out.status).toBe(status);
      expect((out.body as any).code).toBe(code);
    }
  });

  it("maps Zod validation errors to 400", () => {
    let zerr: z.ZodError;
    try {
      z.object({ x: z.string() }).parse({ x: 1 });
      throw new Error("should not reach");
    } catch (e) {
      zerr = e as z.ZodError;
    }
    const out = runHandler(zerr!);
    expect(out.status).toBe(400);
    expect((out.body as any).code).toBe("VALIDATION_ERROR");
    expect(Array.isArray((out.body as any).issues)).toBe(true);
  });

  it("maps PostgreSQL 23505 unique-violation to 409 ConflictError", () => {
    const pgErr = Object.assign(new Error("dup key"), { code: "23505" });
    const mapped = toHttpError(pgErr);
    expect(mapped).toBeInstanceOf(ConflictError);
    const out = runHandler(pgErr);
    expect(out.status).toBe(409);
    expect((out.body as any).code).toBe("CONFLICT");
  });

  it("falls back to 500 for unknown errors", () => {
    const out = runHandler(new Error("kaboom"));
    expect(out.status).toBe(500);
  });

  it("preserves status when an HttpError subclass is thrown", () => {
    class CustomTeapot extends HttpError {
      constructor() {
        super(418, "TEAPOT", "i am a teapot");
      }
    }
    const out = runHandler(new CustomTeapot());
    expect(out.status).toBe(418);
    expect((out.body as any).code).toBe("TEAPOT");
  });
});
