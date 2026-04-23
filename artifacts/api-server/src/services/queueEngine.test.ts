import { describe, it, expect, beforeEach } from "vitest";
import { db, jobsTable, applicationsTable, eventLogsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import {
  applyToJob,
  acknowledgeApplication,
  exitApplication,
  getApplicationStatus,
} from "./queueEngine";
import { resetDb, uniqEmail } from "../__tests__/resetDb";
import { NotFoundError, ConflictError } from "../lib/errors";

async function makeJob(capacity = 2, decaySeconds = 600) {
  const [job] = await db
    .insert(jobsTable)
    .values({ title: "Test", capacity, decaySeconds })
    .returning();
  return job!;
}

describe("queueEngine (DB-backed)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe("applyToJob", () => {
    it("admits up to capacity as ACTIVE, rest WAITLISTED with sequential positions", async () => {
      const job = await makeJob(2);
      const a1 = await applyToJob({ jobId: job.id, name: "A", email: uniqEmail() });
      const a2 = await applyToJob({ jobId: job.id, name: "B", email: uniqEmail() });
      const a3 = await applyToJob({ jobId: job.id, name: "C", email: uniqEmail() });
      const a4 = await applyToJob({ jobId: job.id, name: "D", email: uniqEmail() });

      // State Assertions
      expect(a1.state).toBe("ACTIVE");
      expect(a2.state).toBe("ACTIVE");
      expect(a3.state).toBe("WAITLISTED");
      expect(a4.state).toBe("WAITLISTED");

      // Position Assertions
      expect(a1.queuePosition).toBeNull();
      expect(a3.queuePosition).toBe(1);
      expect(a4.queuePosition).toBe(2);

      // Database-level verification
      const activeCount = await db.execute<{ c: string }>(
        sql`SELECT COUNT(*) FROM applications WHERE job_id = ${job.id} AND state = 'ACTIVE'`
      );
      expect(activeCount.rows[0]?.c).toBe("2");
    });

    it("appends an APPLIED event for every application with correct metadata", async () => {
      const job = await makeJob(1);
      const app = await applyToJob({ jobId: job.id, name: "A", email: uniqEmail() });
      
      const events = await db
        .select()
        .from(eventLogsTable)
        .where(eq(eventLogsTable.applicationId, app.id))
        .orderBy(eventLogsTable.createdAt);

      expect(events).toHaveLength(2); // APPLIED + PROMOTED (since capacity=1)
      expect(events[0]).toMatchObject({
        eventType: "APPLIED",
        metadata: { admittedAs: "ACTIVE" }
      });
      expect(events[1]?.eventType).toBe("PROMOTED");
    });

    it("throws a NotFoundError if the job does not exist", async () => {
      const promise = applyToJob({ jobId: "00000000-0000-0000-0000-000000000000", name: "X", email: uniqEmail() });
      await expect(promise).rejects.toThrow(NotFoundError);
      await expect(promise).rejects.toThrow(/Job not found/);
    });

    it("correctly identifies existing applicants by email", async () => {
      const job = await makeJob(10);
      const email = uniqEmail();
      const a1 = await applyToJob({ jobId: job.id, name: "Original", email });
      const a2 = await applyToJob({ jobId: job.id, name: "Duplicate", email });
      
      expect(a1.applicantId).toBe(a2.applicantId);
      
      const applicants = await db.select().from(applicantsTable).where(eq(applicantsTable.email, email));
      expect(applicants).toHaveLength(1);
    });
  });

  describe("acknowledgeApplication", () => {
    it("clears the ack deadline and records acknowledgedAt", async () => {
      const job = await makeJob(1);
      const app = await applyToJob({ jobId: job.id, name: "A", email: uniqEmail() });
      
      expect(app.ackDeadline).not.toBeNull();
      expect(app.acknowledgedAt).toBeNull();

      const acked = await acknowledgeApplication(app.id);
      
      expect(acked.id).toBe(app.id);
      expect(acked.acknowledgedAt).not.toBeNull();
      expect(acked.ackDeadline).toBeNull();
      expect(acked.state).toBe("ACTIVE");

      const events = await db.select().from(eventLogsTable).where(
        and(eq(eventLogsTable.applicationId, app.id), eq(eventLogsTable.eventType, "ACKNOWLEDGED"))
      );
      expect(events).toHaveLength(1);
    });

    it("throws a ConflictError when acknowledging a WAITLISTED application", async () => {
      const job = await makeJob(1);
      await applyToJob({ jobId: job.id, name: "A", email: uniqEmail() });
      const wait = await applyToJob({ jobId: job.id, name: "B", email: uniqEmail() });
      
      expect(wait.state).toBe("WAITLISTED");
      await expect(acknowledgeApplication(wait.id)).rejects.toThrow(ConflictError);
      await expect(acknowledgeApplication(wait.id)).rejects.toThrow(/must be ACTIVE/);
    });

    it("idempotent: second call returns same object and creates no new events", async () => {
      const job = await makeJob(1);
      const app = await applyToJob({ jobId: job.id, name: "A", email: uniqEmail() });
      
      const first = await acknowledgeApplication(app.id);
      const second = await acknowledgeApplication(app.id);
      
      expect(second.acknowledgedAt?.getTime()).toBe(first.acknowledgedAt?.getTime());
      
      const events = await db.select().from(eventLogsTable).where(
        and(eq(eventLogsTable.applicationId, app.id), eq(eventLogsTable.eventType, "ACKNOWLEDGED"))
      );
      expect(events).toHaveLength(1);
    });
  });

  describe("exitApplication (cascade promotion)", () => {
    it("promotes the head of the waitlist when an ACTIVE applicant exits", async () => {
      const job = await makeJob(1, 300);
      const a = await applyToJob({ jobId: job.id, name: "A", email: uniqEmail() });
      const b = await applyToJob({ jobId: job.id, name: "B", email: uniqEmail() });
      
      expect(a.state).toBe("ACTIVE");
      expect(b.state).toBe("WAITLISTED");

      const result = await exitApplication(a.id);
      expect(result.promoted).toBe(1);
      expect(result.application.state).toBe("EXITED");

      const afterB = await getApplicationStatus(b.id);
      expect(afterB?.app.state).toBe("ACTIVE");
      expect(afterB?.app.queuePosition).toBeNull();
      expect(afterB?.app.ackDeadline).not.toBeNull();
      
      const events = await db.select().from(eventLogsTable).where(eq(eventLogsTable.applicationId, b.id));
      expect(events.some(e => e.eventType === "PROMOTED")).toBe(true);
    });

    it("compacts queue positions when a WAITLISTED applicant exits", async () => {
      const job = await makeJob(1);
      await applyToJob({ jobId: job.id, name: "A", email: uniqEmail() });
      const b = await applyToJob({ jobId: job.id, name: "B", email: uniqEmail() });
      const c = await applyToJob({ jobId: job.id, name: "C", email: uniqEmail() });
      const d = await applyToJob({ jobId: job.id, name: "D", email: uniqEmail() });

      expect(b.queuePosition).toBe(1);
      expect(c.queuePosition).toBe(2);
      expect(d.queuePosition).toBe(3);

      await exitApplication(c.id);

      const afterB = await getApplicationStatus(b.id);
      const afterD = await getApplicationStatus(d.id);

      expect(afterB?.app.queuePosition).toBe(1);
      expect(afterD?.app.queuePosition).toBe(2);
    });

    it("preserves queue gap-free invariant after random churn", async () => {
      const job = await makeJob(2);
      const apps = [];
      for (let i = 0; i < 8; i++) {
        apps.push(await applyToJob({ jobId: job.id, name: `A${i}`, email: uniqEmail() }));
      }

      // Exit a mix of states
      await exitApplication(apps[0]!.id); // ACTIVE
      await exitApplication(apps[2]!.id); // WAITLISTED (pos 1)
      await exitApplication(apps[5]!.id); // WAITLISTED (pos 4)
      await exitApplication(apps[7]!.id); // WAITLISTED (pos 6)

      const waiting = await db
        .select()
        .from(applicationsTable)
        .where(and(eq(applicationsTable.jobId, job.id), eq(applicationsTable.state, "WAITLISTED")))
        .orderBy(applicationsTable.queuePosition);

      const positions = waiting.map((w) => w.queuePosition!);
      const expected = Array.from({ length: positions.length }, (_, i) => i + 1);
      
      expect(positions).toEqual(expected);
      expect(positions.length).toBe(3); // 8 total - 2 initially active - 4 exited + 1 promoted = 3 remaining waitlisted
    });

    it("throws NotFoundError for non-existent application", async () => {
      await expect(exitApplication("00000000-0000-0000-0000-000000000000")).rejects.toThrow(NotFoundError);
    });
  });
});
