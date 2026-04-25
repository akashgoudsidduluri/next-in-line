import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export interface TaskOptions {
  name: string;
  lockId: number;
  intervalMs: number;
}

/**
 * Distributed Leased Task Runner
 * 
 * Contract:
 * - Uses PostgreSQL Advisory Locks to ensure exclusivity across multiple instances.
 * - Manages its own lifecycle (start/stop).
 * - Provides granular logging for lock acquisition and execution.
 */
export class LeasedTaskRunner {
  private running = false;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private options: TaskOptions,
    private task: () => Promise<void>
  ) {}

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    logger.info({ 
      task: this.options.name, 
      intervalMs: this.options.intervalMs, 
      lockId: this.options.lockId 
    }, "Distributed task runner started");
    this.scheduleNext();
  }

  public stop(): void {
    this.stopped = true;
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info({ task: this.options.name }, "Distributed task runner stopped");
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => this.runTick(), this.options.intervalMs);
  }

  private async runTick(): Promise<void> {
    if (this.stopped) return;

    try {
      // Attempt to acquire distributed lock
      const lockRes = await db.execute<{ granted: boolean }>(
        sql`SELECT pg_try_advisory_lock(${this.options.lockId}) as granted`
      );

      if (!lockRes.rows[0]?.granted) {
        // Lock held by another instance; skip this tick.
        return;
      }

      try {
        await this.task();
      } finally {
        // Release lock for next cycle
        await db.execute(sql`SELECT pg_advisory_unlock(${this.options.lockId})`);
      }
    } catch (err) {
      logger.error({ err, task: this.options.name }, "Distributed task tick failed");
    } finally {
      this.scheduleNext();
    }
  }
}
