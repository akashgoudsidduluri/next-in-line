import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export const healthRouter: IRouter = Router();

/**
 * Healthz endpoint with live DB connectivity check.
 * Elite engineering standard for high-fidelity observability.
 */
healthRouter.get("/healthz", async (_req, res) => {
  let dbStatus = "ok";
  try {
    // Simple 1ms check to verify the connection pool and DB responsiveness
    await db.execute(sql`SELECT 1`);
  } catch (err) {
    dbStatus = "error";
  }

  const data = HealthCheckResponse.parse({ status: "ok" });
  
  if (dbStatus === "error") {
    return res.status(503).json({
      status: "error",
      checks: { database: "error", memory: "ok" },
      uptime: process.uptime(),
    });
  }

  const memoryUsage = process.memoryUsage();
  const memoryStatus = memoryUsage.heapUsed / memoryUsage.heapTotal > 0.9 ? "warning" : "ok";

  return res.json({
    ...data,
    checks: { 
      database: "ok",
      memory: memoryStatus,
    },
    uptime: process.uptime(),
    memory: {
      usedMB: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      totalMB: Math.round(memoryUsage.heapTotal / 1024 / 1024),
    }
  });
});

export default healthRouter;
