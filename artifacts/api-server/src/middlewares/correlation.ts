import { type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "crypto";
import { AsyncLocalStorage } from "async_hooks";

/**
 * Global Context for request-scoped metadata.
 * Senior Level Pattern: Use AsyncLocalStorage to propagate Correlation ID 
 * without polluting every function signature in the system.
 */
export const requestContext = new AsyncLocalStorage<{ correlationId: string }>();

/**
 * Correlation ID Middleware
 * 
 * Contract:
 * - Ensures every request has a unique 'x-request-id'.
 * - Reuses existing ID from headers if provided by upstream (e.g. Load Balancer).
 * - Enters an AsyncLocalStorage scope for the duration of the request.
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = (req.headers["x-request-id"] as string) || randomUUID();
  
  // Attach to request for legacy compatibility
  (req as any).correlationId = correlationId;
  
  // Set in response for client traceability
  res.setHeader("x-request-id", correlationId);
  
  // Enter the async scope
  requestContext.run({ correlationId }, () => {
    next();
  });
}

/**
 * Utility to get the current correlation ID from anywhere in the call stack.
 */
export function getCorrelationId(): string | undefined {
  return requestContext.getStore()?.correlationId;
}
