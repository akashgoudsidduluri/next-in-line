import { type Request, type Response, type NextFunction } from "express";
import { logger } from "../lib/logger";

/**
 * Request Metrics Middleware
 * 
 * Contract:
 * - Tracks request duration (latency).
 * - Logs structured metrics for every completion.
 * - Provides visibility into path-level performance and status distribution.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime();

  res.on("finish", () => {
    const diff = process.hrtime(start);
    const durationMs = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(3);
    
    logger.info({
      type: "METRIC",
      method: req.method,
      path: req.baseUrl + req.path,
      statusCode: res.statusCode,
      durationMs: parseFloat(durationMs),
      correlationId: (req as any).correlationId
    }, "Request completed");
  });

  next();
}
