/**
 * Queue Engine — the core deterministic state machine.
 *
 * Invariants (must hold at the end of every transaction):
 *   1. For a given job, count(state=ACTIVE) <= job.capacity.
 *   2. WAITLISTED applications for a job have queue_position 1..N, gap-free.
 *   3. ACTIVE and EXITED applications have queue_position = NULL.
 *   4. Every transition writes an append-only row to event_logs.
 *
 * Concurrency:
 *   Every operation that mutates the queue acquires a row-level lock on the
 *   parent jobs row (`SELECT ... FOR UPDATE`). This serialises all mutations
 *   for a given job while leaving other jobs unaffected. Without this lock,
 *   two simultaneous applies could both see active_count < capacity and both
 *   become ACTIVE, violating invariant (1). With it, the second transaction
 *   blocks until the first commits, then re-reads and routes correctly.
 */

import { sql, eq, and, asc } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  jobsTable,
  applicantsTable,
  applicationsTable,
  eventLogsTable,
  type Application,
  type EventType,
} from "@workspace/db";
import { NotFoundError, ConflictError, HttpError } from "../lib/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const PENALTY_OFFSET = 2; // decayed applicants drop 2 positions further back

/**
 * Lock the job row to serialise queue mutations for this job.
 * Throws if the job does not exist.
 */
async function lockJob(tx: Tx, jobId: string) {
  const rows = await tx.execute<{
    id: string;
    capacity: number;
    decay_seconds: number;
  }>(
    sql`SELECT id, capacity, decay_seconds FROM jobs WHERE id = ${jobId} FOR UPDATE`,
  );
  const row = rows.rows[0];
  if (!row) throw new NotFoundError(`Job not found: ${jobId}`);
  return {
    id: row.id,
    capacity: Number(row.capacity),
    decaySeconds: Number(row.decay_seconds),
  };
}

async function countActive(tx: Tx, jobId: string): Promise<number> {
  const rows = await tx.execute<{ c: string }>(
    sql`SELECT COUNT(*)::text AS c FROM applications WHERE job_id = ${jobId} AND state = 'ACTIVE'`,
  );
  return Number(rows.rows[0]?.c ?? 0);
}

async function maxQueuePosition(tx: Tx, jobId: string): Promise<number> {
  const rows = await tx.execute<{ m: number | null }>(
    sql`SELECT COALESCE(MAX(queue_position), 0) AS m FROM applications WHERE job_id = ${jobId} AND state = 'WAITLISTED'`,
  );
  return Number(rows.rows[0]?.m ?? 0);
}

async function logEvent(
  tx: Tx,
  applicationId: string,
  jobId: string,
  eventType: EventType,
  metadata: Record<string, unknown> = {},
) {
  await tx.insert(eventLogsTable).values({
    applicationId,
    jobId,
    eventType,
    metadata: metadata as never,
  });
}

/**
 * Promote the head of the waitlist (queue_position = 1) to ACTIVE.
 * Caller must hold the job lock. No-op if the waitlist is empty or capacity is full.
 * Returns the promoted application, or null.
 */
async function promoteHeadIfPossible(
  tx: Tx,
  jobId: string,
  decaySeconds: number,
  capacity: number,
): Promise<Application | null> {
  const active = await countActive(tx, jobId);
  if (active >= capacity) return null;

  const head = await tx
    .select()
    .from(applicationsTable)
    .where(
      and(
        eq(applicationsTable.jobId, jobId),
        eq(applicationsTable.state, "WAITLISTED"),
        eq(applicationsTable.queuePosition, 1),
      ),
    )
    .limit(1);
  if (!head[0]) return null;

  const ackDeadline = new Date(Date.now() + decaySeconds * 1000);

  // Free the unique (jobId, queuePosition) slot before reflowing.
  const [promoted] = await tx
    .update(applicationsTable)
    .set({
      state: "ACTIVE",
      queuePosition: null,
      ackDeadline,
      acknowledgedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(applicationsTable.id, head[0].id))
    .returning();

  // Compact the rest of the waitlist (positions 2..N -> 1..N-1).
  await tx.execute(
    sql`UPDATE applications SET queue_position = queue_position - 1, updated_at = NOW()
        WHERE job_id = ${jobId} AND state = 'WAITLISTED' AND queue_position > 1`,
  );

  if (!promoted) return null;
  await logEvent(tx, promoted.id, jobId, "PROMOTED", {
    ackDeadline: ackDeadline.toISOString(),
    decayCount: promoted.decayCount,
  });
  return promoted;
}

/**
 * Cascade-promote until either capacity is full or the waitlist is empty.
 * Returns the number of applications promoted.
 */
async function cascadePromote(
  tx: Tx,
  jobId: string,
  decaySeconds: number,
  capacity: number,
): Promise<number> {
  let promoted = 0;
  while (true) {
    const next = await promoteHeadIfPossible(tx, jobId, decaySeconds, capacity);
    if (!next) break;
    promoted++;
  }
  return promoted;
}

/* ─────────────────────────  PUBLIC OPERATIONS  ───────────────────────── */

export interface ApplyInput {
  jobId: string;
  applicantId: string;
}

/**
 * Apply to a job. Atomic and capacity-aware.
 *
 * The job row is locked for the duration of the transaction. If active count
 * is below capacity the new application becomes ACTIVE with an ack deadline;
 * otherwise it is appended to the waitlist at position max(pos)+1.
 */
export async function applyToJob(input: ApplyInput): Promise<Application> {
  return db.transaction(async (tx) => {
    const job = await lockJob(tx, input.jobId);

    const active = await countActive(tx, input.jobId);

    if (active < job.capacity) {
      const ackDeadline = new Date(Date.now() + job.decaySeconds * 1000);
      const [app] = await tx
        .insert(applicationsTable)
        .values({
          jobId: input.jobId,
          applicantId: input.applicantId,
          state: "ACTIVE",
          queuePosition: null,
          ackDeadline,
        })
        .returning();
      if (!app) throw new HttpError(500, "DATABASE_ERROR", "Failed to create application");
      await logEvent(tx, app.id, input.jobId, "APPLIED", {
        admittedAs: "ACTIVE",
      });
      await logEvent(tx, app.id, input.jobId, "PROMOTED", {
        reason: "INITIAL_ADMISSION",
        ackDeadline: ackDeadline.toISOString(),
      });
      return app;
    }

    const nextPos = (await maxQueuePosition(tx, input.jobId)) + 1;
    const [app] = await tx
      .insert(applicationsTable)
      .values({
        jobId: input.jobId,
        applicantId: input.applicantId,
        state: "WAITLISTED",
        queuePosition: nextPos,
      })
      .returning();
    if (!app) throw new HttpError(500, "DATABASE_ERROR", "Failed to create application");
    await logEvent(tx, app.id, input.jobId, "APPLIED", {
      admittedAs: "WAITLISTED",
      queuePosition: nextPos,
    });
    return app;
  });
}

/**
 * Acknowledge an active promotion. Clears the ack deadline and records the
 * acknowledgement; no queue mutation needed.
 */
export async function acknowledgeApplication(
  applicationId: string,
): Promise<Application> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(applicationsTable)
      .where(eq(applicationsTable.id, applicationId))
      .limit(1);
    const app = existing[0];
    if (!app) throw new NotFoundError(`Application not found: ${applicationId}`);
    await lockJob(tx, app.jobId);
    if (app.state !== "ACTIVE")
      throw new ConflictError(
        `Cannot acknowledge application in state ${app.state} (must be ACTIVE)`,
      );
    if (app.acknowledgedAt) return app;

    const now = new Date();
    const [updated] = await tx
      .update(applicationsTable)
      .set({ acknowledgedAt: now, ackDeadline: null, updatedAt: now })
      .where(eq(applicationsTable.id, applicationId))
      .returning();
    if (!updated) throw new HttpError(500, "DATABASE_ERROR", "Failed to acknowledge application");
    await logEvent(tx, updated.id, updated.jobId, "ACKNOWLEDGED", {});
    return updated;
  });
}

/**
 * Exit the pipeline. Triggers cascading promotion if the exiting application
 * was ACTIVE.
 */
export async function exitApplication(
  applicationId: string,
): Promise<{ application: Application; promoted: number }> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(applicationsTable)
      .where(eq(applicationsTable.id, applicationId))
      .limit(1);
    const app = existing[0];
    if (!app) throw new NotFoundError(`Application not found: ${applicationId}`);
    const job = await lockJob(tx, app.jobId);
    if (app.state === "EXITED") return { application: app, promoted: 0 };

    const wasWaitlisted = app.state === "WAITLISTED";
    const exitedPos = app.queuePosition ?? null;

    const [updated] = await tx
      .update(applicationsTable)
      .set({
        state: "EXITED",
        queuePosition: null,
        ackDeadline: null,
        updatedAt: new Date(),
      })
      .where(eq(applicationsTable.id, applicationId))
      .returning();
    if (!updated) throw new HttpError(500, "DATABASE_ERROR", "Failed to exit application");

    // If a waitlisted applicant exited, compact the queue behind them.
    if (wasWaitlisted && exitedPos != null) {
      await tx.execute(
        sql`UPDATE applications SET queue_position = queue_position - 1, updated_at = NOW()
            WHERE job_id = ${app.jobId} AND state = 'WAITLISTED' AND queue_position > ${exitedPos}`,
      );
    }
    await logEvent(tx, updated.id, updated.jobId, "EXITED", {
      previousState: app.state,
    });

    const promoted = await cascadePromote(
      tx,
      app.jobId,
      job.decaySeconds,
      job.capacity,
    );
    return { application: updated, promoted };
  });
}

/**
 * Decay handler — invoked by the scheduler when an ACTIVE applicant fails to
 * acknowledge before their deadline. The applicant is NOT removed; they are
 * pushed back onto the waitlist at position min(maxPos + 1, currentPos +
 * PENALTY_OFFSET) and the head of the waitlist is promoted to take their slot.
 *
 * Returns true if a decay actually happened (i.e. the application was still
 * unacknowledged ACTIVE when the lock was acquired). The scheduler can then
 * run again to handle further cascades.
 */
export async function decayActiveApplication(
  applicationId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(applicationsTable)
      .where(eq(applicationsTable.id, applicationId))
      .limit(1);
    const app = existing[0];
    if (!app) return false;
    const job = await lockJob(tx, app.jobId);

    // Re-check after lock — they may have ack'd in between.
    if (
      app.state !== "ACTIVE" ||
      app.acknowledgedAt != null ||
      app.ackDeadline == null ||
      app.ackDeadline.getTime() > Date.now()
    ) {
      return false;
    }

    // Decayed applicants move to the very back of the waitlist.
    // This maintains the gap-free invariant while ensuring they 
    // must wait for the entire current waitlist to be processed.
    const maxPos = await maxQueuePosition(tx, app.jobId);
    const newPos = maxPos + 1;

    const [decayed] = await tx
      .update(applicationsTable)
      .set({
        state: "WAITLISTED",
        queuePosition: newPos,
        ackDeadline: null,
        acknowledgedAt: null,
        decayCount: app.decayCount + 1,
        updatedAt: new Date(),
      })
      .where(eq(applicationsTable.id, applicationId))
      .returning();
    if (!decayed) return false;

    await logEvent(tx, decayed.id, decayed.jobId, "DECAYED", {
      newQueuePosition: newPos,
      decayCount: decayed.decayCount,
    });

    // Promote the next head into the freed slot — and cascade in case more
    // slots are open or another decay just happened on the same job.
    await cascadePromote(tx, app.jobId, job.decaySeconds, job.capacity);
    return true;
  });
}

/**
 * Find all ACTIVE applications whose ack_deadline has passed. The scheduler
 * polls this and decays each one in its own transaction.
 */
export async function findExpiredActiveApplicationIds(): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(
    sql`SELECT id FROM applications
        WHERE state = 'ACTIVE'
          AND acknowledged_at IS NULL
          AND ack_deadline IS NOT NULL
          AND ack_deadline < NOW()
        ORDER BY ack_deadline ASC
        LIMIT 100`,
  );
  return rows.rows.map((r) => r.id);
}

/* ─────────────────────────  READ HELPERS  ───────────────────────── */

export async function getApplicationStatus(applicationId: string) {
  const rows = await db
    .select({
      app: applicationsTable,
      applicant: applicantsTable,
    })
    .from(applicationsTable)
    .innerJoin(
      applicantsTable,
      eq(applicantsTable.id, applicationsTable.applicantId),
    )
    .where(eq(applicationsTable.id, applicationId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getJobDashboard(jobId: string) {
  const jobRow = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId))
    .limit(1);
  if (!jobRow[0]) return null;

  // Optimize: Fetch active and waitlisted applicants in parallel with correct ordering
  const [active, waitlist, recentEvents] = await Promise.all([
    db
      .select({ app: applicationsTable, applicant: applicantsTable })
      .from(applicationsTable)
      .innerJoin(applicantsTable, eq(applicantsTable.id, applicationsTable.applicantId))
      .where(and(eq(applicationsTable.jobId, jobId), eq(applicationsTable.state, "ACTIVE"))),
    
    db
      .select({ app: applicationsTable, applicant: applicantsTable })
      .from(applicationsTable)
      .innerJoin(applicantsTable, eq(applicantsTable.id, applicationsTable.applicantId))
      .where(and(eq(applicationsTable.jobId, jobId), eq(applicationsTable.state, "WAITLISTED")))
      .orderBy(asc(applicationsTable.queuePosition)),

    db
      .select()
      .from(eventLogsTable)
      .where(eq(eventLogsTable.jobId, jobId))
      .orderBy(sql`created_at DESC`)
      .limit(20)
  ]);

  return {
    job: jobRow[0],
    active,
    waitlist,
    recentEvents,
  };
}

