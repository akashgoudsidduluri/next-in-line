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

import { sql, eq, and, asc, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  jobsTable,
  applicantsTable,
  applicationsTable,
  eventLogsTable,
  type Application,
  type EventType,
  type Applicant,
  type Job,
  type EventLog,
} from "@workspace/db";
import { NotFoundError, ConflictError, DatabaseInsertError, DatabaseUpdateError } from "../lib/errors";
import { logger } from "../lib/logger";
import { toDashboardDto, type DashboardDto, toApplicationDto, type ApplicationDto, toApplicationStatusDto, type ApplicationStatusDto } from "./dto";
import { withTransaction } from "../lib/transaction";
import { type PgTransaction } from "drizzle-orm/pg-core";
import { requestContext } from "../middlewares/correlation";

type Tx = PgTransaction<any, any, any>;



/**
 * Lock the job row to serialise queue mutations for this job.
 * 
 * Contract:
 * - Side Effects: Acquires a row-level write lock (SELECT FOR UPDATE) on the jobs table.
 * - Throws: NotFoundError if the jobId does not exist.
 * - Return: Job metadata (id, capacity, decaySeconds).
 */
async function lockJob(tx: Tx, jobId: string) {
  logger.debug({ jobId }, "Acquiring job lock");
  const rows = await tx
    .select({
      id: jobsTable.id,
      capacity: jobsTable.capacity,
      decaySeconds: jobsTable.decaySeconds,
    })
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId))
    .for("update");

  const row = rows[0];
  if (!row) {
    logger.warn({ jobId }, "Lock acquisition failed: job not found");
    throw new NotFoundError(`Job not found: ${jobId}`);
  }
  return {
    id: row.id,
    capacity: row.capacity,
    decaySeconds: row.decaySeconds,
  };
}

async function countActive(tx: Tx, jobId: string): Promise<number> {
  const rows = await tx.execute<{ c: string }>(
    sql`SELECT COUNT(*)::text AS c FROM applications WHERE job_id = ${jobId} AND state = 'ACTIVE'`,
  );
  return Number(rows.rows[0]?.c ?? 0);
}

async function maxQueuePosition(tx: Tx, jobId: string): Promise<number> {
  const result = await tx.execute(
    sql`SELECT COALESCE(MAX(queue_position), 0) AS m FROM applications WHERE job_id = ${jobId} AND state = 'WAITLISTED'`,
  );
  const rows = result.rows as unknown as { m: number | null }[];
  return Number(rows[0]?.m ?? 0);
}

async function logEvent(
  tx: Tx,
  applicationId: string,
  jobId: string,
  eventType: EventType,
  metadata: Record<string, unknown> = {},
) {
  const correlationId = requestContext.getStore()?.correlationId;
  await tx.insert(eventLogsTable).values({
    applicationId,
    jobId,
    eventType,
    metadata: metadata as never,
    schemaVersion: "v1",
    correlationId,
  });
}

/**
 * Promote the head of the waitlist (queue_position = 1) to ACTIVE.
 * 
 * Invariants:
 * - Must be called within a transaction holding the job lock.
 * - Promotion only occurs if current ACTIVE count < capacity.
 * - If promoted, the waitlist is compacted (positions 2..N reflow to 1..N-1).
 * 
 * Returns the promoted application, or null if capacity is full or waitlist is empty.
 */
async function promoteHeadIfPossible(
  tx: Tx,
  jobId: string,
  decaySeconds: number,
  capacity: number,
  reason: "EXIT_RECOVERY" | "DECAY_RECOVERY" | "CAPACITY_EXPANSION",
): Promise<Application | null> {
  const active = await countActive(tx, jobId);
  if (active >= capacity) {
    logger.info({ jobId, active, capacity }, "Promotion skipped: job at full capacity");
    return null;
  }

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
  
  if (!head[0]) {
    logger.debug({ jobId }, "Promotion skipped: waitlist is empty");
    return null;
  }

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

  if (!promoted) {
    throw new DatabaseUpdateError("Application", "Failed to promote waitlisted applicant");
  }

  logger.info({ 
    jobId, 
    applicationId: promoted.id, 
    reason,
    ackDeadline 
  }, "Waitlist head promoted to ACTIVE");

  await logEvent(tx, promoted.id, jobId, "PROMOTED", {
    reason,
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
  reason: "EXIT_RECOVERY" | "DECAY_RECOVERY" | "CAPACITY_EXPANSION",
): Promise<number> {
  let promoted = 0;
  while (true) {
    const next = await promoteHeadIfPossible(tx, jobId, decaySeconds, capacity, reason);
    if (!next) break;
    promoted++;
  }
  
  if (promoted > 0) {
    logger.info({ jobId, promoted, reason }, "Cascade promotion complete");
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
 * Contract:
 * - Invariants: For a given job, total ACTIVE apps <= capacity.
 * - Side Effects:
 *   1. Locks the job row.
 *   2. Inserts application row.
 *   3. Writes APPLIED and potentially PROMOTED events.
 * - Logic: If (count(ACTIVE) < capacity) -> ACTIVE else -> WAITLISTED at back.
 * - Return: Mapped ApplicationDto.
 */
export async function applyToJob(input: ApplyInput, existingTx?: Tx): Promise<ApplicationDto> {
  return withTransaction(async (tx) => {
    const job = await lockJob(tx, input.jobId);
    const active = await countActive(tx, input.jobId);

    if (active < job.capacity) {
      logger.info({ jobId: input.jobId, applicantId: input.applicantId, active, capacity: job.capacity }, "Admitting applicant as ACTIVE");
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
      if (!app) throw new DatabaseInsertError("Application");
      await logEvent(tx, app.id, input.jobId, "APPLIED", {
        admittedAs: "ACTIVE",
      });
      await logEvent(tx, app.id, input.jobId, "PROMOTED", {
        reason: "INITIAL_ADMISSION",
        ackDeadline: ackDeadline.toISOString(),
      });
      return toApplicationDto(app);
    }

    const nextPos = (await maxQueuePosition(tx, input.jobId)) + 1;
    logger.info({ jobId: input.jobId, applicantId: input.applicantId, queuePosition: nextPos }, "Admitting applicant as WAITLISTED");
    const [app] = await tx
      .insert(applicationsTable)
      .values({
        jobId: input.jobId,
        applicantId: input.applicantId,
        state: "WAITLISTED",
        queuePosition: nextPos,
      })
      .returning();
    if (!app) throw new DatabaseInsertError("Application");
    await logEvent(tx, app.id, input.jobId, "APPLIED", {
      admittedAs: "WAITLISTED",
      queuePosition: nextPos,
    });
    return toApplicationDto(app);
  }, "apply-to-job", existingTx);
}

/**
 * Update job settings. If capacity increases, tries to promote waitlisted applicants.
 * Returns the number of applicants promoted.
 */
export async function updateJob(
  jobId: string,
  input: { capacity?: number; decaySeconds?: number },
): Promise<number> {
  return withTransaction(async (tx) => {
    const job = await lockJob(tx, jobId);

    await tx
      .update(jobsTable)
      .set({
        capacity: input.capacity ?? job.capacity,
        decaySeconds: input.decaySeconds ?? job.decaySeconds,
      })
      .where(eq(jobsTable.id, jobId));

    // If capacity increased, try to fill new slots from the waitlist
    let promoted = 0;
    if (input.capacity && input.capacity > job.capacity) {
      promoted = await cascadePromote(
        tx,
        jobId,
        input.decaySeconds ?? job.decaySeconds,
        input.capacity,
        "CAPACITY_EXPANSION",
      );
    }
    return promoted;
  }, "update-job");
}

/**
 * Acknowledge an active promotion. Clears the ack deadline and records the
 * acknowledgement; no queue mutation needed.
 */
export async function acknowledgeApplication(
  applicationId: string,
): Promise<ApplicationDto> {
  return withTransaction(async (tx) => {
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
    if (app.acknowledgedAt) return toApplicationDto(app);

    const now = new Date();
    const [updated] = await tx
      .update(applicationsTable)
      .set({ acknowledgedAt: now, ackDeadline: null, updatedAt: now })
      .where(eq(applicationsTable.id, applicationId))
      .returning();
    if (!updated) throw new DatabaseUpdateError("Application", "Failed to acknowledge application");
    await logEvent(tx, updated.id, updated.jobId, "ACKNOWLEDGED", {});
    return toApplicationDto(updated);
  }, "acknowledge-application");
}

/**
 * Exit the pipeline. Triggers cascading promotion if the exiting application
 * was ACTIVE.
 */
export async function exitApplication(
  applicationId: string,
): Promise<{ application: ApplicationDto; promoted: number }> {
  return withTransaction(async (tx) => {
    const existing = await tx
      .select()
      .from(applicationsTable)
      .where(eq(applicationsTable.id, applicationId))
      .limit(1);
    const app = existing[0];
    if (!app) throw new NotFoundError(`Application not found: ${applicationId}`);
    const job = await lockJob(tx, app.jobId);
    if (app.state === "EXITED") return { application: toApplicationDto(app), promoted: 0 };

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
    if (!updated) throw new DatabaseUpdateError("Application", "Failed to exit application");

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
      "EXIT_RECOVERY",
    );
    return { application: toApplicationDto(updated), promoted };
  }, "exit-application");
}

/**
 * Decay handler — invoked when an ACTIVE applicant fails to acknowledge.
 *
 * Contract:
 * - Invariants:
 *   1. Decayed apps return to WAITLISTED at the very back (maxPosition + 1).
 *   2. Freed ACTIVE slot is immediately filled by head of waitlist (cascading).
 * - Side Effects:
 *   1. Re-validates state/deadline after lock.
 *   2. Updates application state to WAITLISTED.
 *   3. Triggers cascadePromote.
 * - Return: Boolean (true if decay was processed, false if state had changed).
 */
export async function decayActiveApplication(
  applicationId: string,
): Promise<boolean> {
  return withTransaction(async (tx) => {
    const existing = await tx
      .select()
      .from(applicationsTable)
      .where(eq(applicationsTable.id, applicationId))
      .limit(1);
    const app = existing[0];
    if (!app) return false;
    const job = await lockJob(tx, app.jobId);

    // Re-read application state AFTER acquiring the lock to ensure we are acting on fresh data.
    const currentRows = await tx
      .select()
      .from(applicationsTable)
      .where(eq(applicationsTable.id, applicationId))
      .limit(1);
    const currentApp = currentRows[0];
    
    if (
      !currentApp ||
      currentApp.state !== "ACTIVE" ||
      currentApp.acknowledgedAt != null ||
      currentApp.ackDeadline == null ||
      currentApp.ackDeadline.getTime() > Date.now()
    ) {
      logger.debug({ applicationId, state: currentApp?.state, ackAt: currentApp?.acknowledgedAt }, "Decay aborted: application state no longer eligible");
      return false;
    }

    const maxPos = await maxQueuePosition(tx, currentApp.jobId);
    const newPos = maxPos + 1;
    logger.info({ applicationId, jobId: currentApp.jobId, newPos }, "Processing application decay");

    const [decayed] = await tx
      .update(applicationsTable)
      .set({
        state: "WAITLISTED",
        queuePosition: newPos,
        ackDeadline: null,
        acknowledgedAt: null,
        decayCount: currentApp.decayCount + 1,
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
    await cascadePromote(tx, app.jobId, job.decaySeconds, job.capacity, "DECAY_RECOVERY");
    return true;
  }, "decay-application");
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

export async function getApplicationStatus(applicationId: string): Promise<ApplicationStatusDto | null> {
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
  const row = rows[0];
  return row ? toApplicationStatusDto(row.app, row.applicant) : null;
}

export async function getJobDashboard(jobId: string): Promise<DashboardDto | null> {
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

  return toDashboardDto(jobRow[0], active, waitlist, recentEvents);
}

/* ─────────────────────────  OWNERSHIP & AUTH HELPERS  ───────────────────────── */

/** Look up the email of the auth'd applicant for ownership checks. */
export async function getApplicantEmail(applicantId: string): Promise<string | null> {
  const rows = await db
    .select({ email: applicantsTable.email })
    .from(applicantsTable)
    .where(eq(applicantsTable.id, applicantId))
    .limit(1);
  return rows[0]?.email ?? null;
}

/** True iff the application's applicant matches the auth'd applicant (by email). */
export async function applicationBelongsToApplicant(
  applicationId: string,
  applicantId: string,
): Promise<boolean> {
  const email = await getApplicantEmail(applicantId);
  if (!email) return false;
  const result = await db.execute(sql`
    SELECT TRUE AS ok FROM applications app
    JOIN applicants ap ON ap.id = app.applicant_id
    WHERE app.id = ${applicationId} AND ap.email = ${email}
    LIMIT 1
  `);
  const rows = result.rows as unknown as { ok: boolean }[];
  return Boolean(rows[0]?.ok);
}

/** True iff the job's company matches the auth'd company. */
export async function jobBelongsToCompany(
  jobId: string,
  companyId: string,
): Promise<boolean> {
  const rows = await db
    .select({ companyId: jobsTable.companyId })
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId))
    .limit(1);
  const row = rows[0];
  if (!row) return false;
  return row.companyId === companyId;
}

/**
 * Apply to a job as an already-registered applicant.
 * Enforces duplicate check and role-based exclusivity.
 */
export async function applyAsRegisteredApplicant(input: {
  jobId: string;
  applicantId: string;
}) {
  return withTransaction(async (tx) => {
    await lockJob(tx, input.jobId);
    
    const applicantRows = await tx
      .select()
      .from(applicantsTable)
      .where(eq(applicantsTable.id, input.applicantId))
      .limit(1);
    const applicant = applicantRows[0];
    if (!applicant) throw new NotFoundError("Applicant not found");

    // Reject in-flight duplicate applications
    const inFlight = await tx.execute(sql`
      SELECT app.id FROM applications app
      JOIN applicants ap ON ap.id = app.applicant_id
      WHERE app.job_id = ${input.jobId}
        AND ap.email = ${applicant.email}
        AND app.state IN ('ACTIVE', 'WAITLISTED')
      LIMIT 1
    `);
    const inFlightRows = inFlight.rows as unknown as { id: string }[];
    if (inFlightRows[0]) {
      throw new ConflictError("You already have an active application for this job");
    }

    // Reuse core logic
    return applyToJob(input, tx);
  }, "apply-registered");
}

/** List all applications for a specific applicant, including their live status. */
export async function getMyApplications(
  applicantId: string,
): Promise<ApplicationStatusDto[]> {
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
    .where(eq(applicationsTable.applicantId, applicantId))
    .orderBy(desc(applicationsTable.createdAt));

  return rows.map((row) => toApplicationStatusDto(row.app, row.applicant));
}

