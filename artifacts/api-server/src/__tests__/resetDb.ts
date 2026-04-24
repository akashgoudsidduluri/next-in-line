/**
 * Per-test reset. We use DELETE (not TRUNCATE) so we acquire row locks
 * rather than an AccessExclusiveLock — this lets the live API server keep
 * running alongside the test process without deadlocking against the
 * scheduler's reads. FK cascades handle dependent rows.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export async function resetDb(): Promise<void> {
  try {
    // Connectivity check to provide a clear error if the DB is missing
    await db.execute(sql`SELECT 1`);
  } catch (err: any) {
    console.error("❌ Database Connection Failure in Tests");
    console.error(`Attempted to connect to database at: ${process.env.DATABASE_URL || "localhost:5432"}`);
    console.error("Reason:", err.message);
    throw new Error("Integration tests require a running PostgreSQL instance. Please check your DATABASE_URL.");
  }

  await db.execute(sql`DELETE FROM event_logs`);
  await db.execute(sql`DELETE FROM applications`);
  await db.execute(sql`DELETE FROM applicants`);
  await db.execute(sql`DELETE FROM jobs`);
  await db.execute(sql`DELETE FROM companies`);
}

/** Generate a unique email so tests can run interleaved without collisions. */
let counter = 0;
export function uniqEmail(prefix = "test"): string {
  counter += 1;
  return `${prefix}-${process.pid}-${Date.now()}-${counter}@example.test`;
}
