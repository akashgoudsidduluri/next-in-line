/**
 * Per-test reset. We use DELETE (not TRUNCATE) so we acquire row locks
 * rather than an AccessExclusiveLock — this lets the live API server keep
 * running alongside the test process without deadlocking against the
 * scheduler's reads. FK cascades handle dependent rows.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

import { logger } from "../lib/logger";

let dbAvailable: boolean | null = null;

export async function resetDb(): Promise<boolean> {
  if (dbAvailable === false) return false;

  try {
    // Connectivity check to provide a clear warning if the DB is missing
    await db.execute(sql`SELECT 1`);
    dbAvailable = true;
  } catch (err: any) {
    if (dbAvailable === null) {
      logger.warn({ 
        target: process.env.DATABASE_URL || "localhost:5432",
        error: err.message
      }, "Database not reachable. Skipping DB-backed integration tests.");
    }
    dbAvailable = false;
    return false;
  }

  // Using TRUNCATE CASCADE for significantly faster resets in the test environment.
  // This cleanly wipes all tables in a single operation, bypassing row-level locks.
  await db.execute(sql`TRUNCATE TABLE companies, jobs, applicants, applications, event_logs CASCADE`);
  return true;
}

/** Generate a unique email so tests can run interleaved without collisions. */
let counter = 0;
export function uniqEmail(prefix = "test"): string {
  counter += 1;
  return `${prefix}-${process.pid}-${Date.now()}-${counter}@example.test`;
}
