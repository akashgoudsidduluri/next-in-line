import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

/**
 * Healthz endpoint with live DB connectivity check.
 * Elite engineering standard for high-fidelity observability.
 */
router.get("/healthz", async (_req, res) => {
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
      checks: { database: "error" }
    });
  }

  return res.json({
    ...data,
    checks: { database: "ok" }
  });
});

export default router;
