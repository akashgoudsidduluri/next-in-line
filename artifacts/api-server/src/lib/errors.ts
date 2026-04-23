/**
 * Typed error classes — every error thrown by routes/services should be one of
 * these. The error handler middleware maps them to HTTP status codes.
 *
 * Plain `Error`s are treated as 500s (genuinely unexpected).
 */

export class HttpError extends Error {
  public readonly status: number;
  public readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = this.constructor.name;
  }
}

export class BadRequestError extends HttpError {
  constructor(message = "Bad request") {
    super(400, "BAD_REQUEST", message);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = "Unauthorized") {
    super(401, "UNAUTHORIZED", message);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = "Forbidden") {
    super(403, "FORBIDDEN", message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Not found") {
    super(404, "NOT_FOUND", message);
  }
}

export class ConflictError extends HttpError {
  constructor(message = "Conflict") {
    super(409, "CONFLICT", message);
  }
}

export class InvalidTransitionError extends HttpError {
  constructor(from: string, to: string) {
    super(
      409,
      "INVALID_TRANSITION",
      `Invalid state transition: ${from} -> ${to}`,
    );
  }
}

/**
 * Map an unknown thrown value to an HttpError. Recognises the typed errors
 * above and the PostgreSQL unique-violation code (23505) which Drizzle/pg
 * surfaces with `err.code === "23505"`.
 */
export function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (code === "23505") {
      return new ConflictError("Resource already exists");
    }
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  // Heuristic mapping from legacy string errors that pre-date typed errors.
  if (/not found/i.test(message)) return new NotFoundError(message);
  if (/cannot acknowledge|invalid state/i.test(message)) {
    return new ConflictError(message);
  }
  return new HttpError(500, "INTERNAL", message);
}
