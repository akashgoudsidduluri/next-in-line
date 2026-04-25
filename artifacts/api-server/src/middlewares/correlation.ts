import { type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "crypto";

/**
 * Correlation ID Middleware
 * 
 * Contract:
 * - Ensures every request has a unique 'x-request-id'.
 * - Reuses existing ID from headers if provided by upstream (e.g. Load Balancer).
 * - Attaches the ID to the response headers and request object.
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = (req.headers["x-request-id"] as string) || randomUUID();
  
  // Attach to request for downstream use (logging, spans)
  (req as any).correlationId = correlationId;
  
  // Set in response for client traceability
  res.setHeader("x-request-id", correlationId);
  
  next();
}
