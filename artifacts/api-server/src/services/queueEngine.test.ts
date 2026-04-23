import { describe, it, expect, beforeEach } from "vitest";
import { db, jobsTable, applicationsTable, eventLogsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  applyToJob,
  acknowledgeApplication,
  exitApplication,
  getApplicationStatus,
} from "./queueEngine";
import { resetDb, uniqEmail } from "../__tests__/resetDb";

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
      expect(a1.state).toBe("ACTIVE");
      expect(a2.state).toBe("ACTIVE");
      expect(a3.state).toBe("WAITLISTED");
      expect(a3.queuePosition).toBe(1);
      expect(a4.queuePosition).toBe(2);
    });

    it("appends an APPLIED event for every application", async () => {
      const job = await makeJob(1);
      const app = await applyToJob({ jobId: job.id, name: "A", email: uniqEmail() });
      const events = await db
        .select()
        .from(eventLogsTable)
        .where(eq(eventLogsTable.applicationId, app.id));
      expect(events.some((e) => e.eventType === "APPLIED")).toBe(true);
    });

    it("throws if the job does not exist", async () => {
      await expect(
        applyToJob({ jobId: "no-such-job", name: "X", email: uniqEmail() }),
      ).rejects.toThrow();
    });
  });

  describe("acknowledgeApplication", () => {
    it("clears the ack deadline and records acknowledgedAt", async () => {
      const job = await makeJob(1);
      const app = await applyToJob({ jobId: job.id, name: "A", email: uniqEmail() });
      expect(app.ackDeadline).not.toBeNull();
      const acked = await acknowledgeApplication(app.id);
      expect(acked.acknowledgedAt).not.toBeNull();
      expect(acked.ackDeadline).toBeNull();
    });

    it("rejects acknowledging a WAITLISTED application", async () => {
      const job = await makeJob(1);
      await applyToJob({ jobId: job.id, name: "A", email: uniqEmail() });
      const wait = await applyToJob({ jobId: job.id, name: "B", email: uniqEmail() });
      expect(wait.state).toBe("WAITLISTED");
      await expect(acknowledgeApplication(wait.id)).rejects.toThrow(/Cannot acknowledge/);
    });

    it("idempotent on a second call", async () => {
      const job = await makeJob(1);
      const app = await applyToJob({ jobId: job.id, name: "A", email: uniqEmail() });
      const first = await acknowledgeApplication(app.id);
      const second = await acknowledgeApplication(app.id);
      expect(second.acknowledgedAt?.getTime()).toBe(first.acknowledgedAt?.getTime());
    });
  });

  describe("exitApplication (cascade promotion)", () => {
    it("promotes the head of the waitlist when an ACTIVE applicant exits", async () => {
      const job = await makeJob(1);
      const a = await applyToJob({ jobId: job.id, name: "A", email: uniqEmail() });
      const b = await applyToJob({ jobId: job.id, name: "B", email: uniqEmail() });
      expect(b.state).toBe("WAITLISTED");
      await exitApplication(a.id);
      const after = await getApplicationStatus(b.id);
      expect(after?.app.state).toBe("ACTIVE");
      expect(after?.app.queuePosition).toBeNull();
    });

    it("compacts queue positions when a WAITLISTED applicant exits", async () => {
      const job = await makeJob(1);
      await applyToJob({ jobId: job.id, name: "A", email: uniqEmail() });
      const b = await applyToJob({ jobId: job.id, name: "B", email: uniqEmail() });
      const c = await applyToJob({ jobId: job.id, name: "C", email: uniqEmail() });
      expect(b.queuePosition).toBe(1);
      expect(c.queuePosition).toBe(2);
      await exitApplication(b.id);
      const after = await getApplicationStatus(c.id);
      expect(after?.app.queuePosition).toBe(1);
    });

    it("is a no-op on an already-EXITED application", async () => {
      const job = await makeJob(1);
      const a = await applyToJob({ jobId: job.id, name: "A", email: uniqEmail() });
      const r1 = await exitApplication(a.id);
      const r2 = await exitApplication(a.id);
      expect(r1.application.state).toBe("EXITED");
      expect(r2.promoted).toBe(0);
    });

    it("preserves queue gap-free invariant after random ops", async () => {
      const job = await makeJob(2);
      const apps = [];
      for (let i = 0; i < 6; i++) {
        apps.push(
          await applyToJob({ jobId: job.id, name: `A${i}`, email: uniqEmail() }),
        );
      }
      // exit one ACTIVE and one WAITLISTED
      await exitApplication(apps[0]!.id);
      await exitApplication(apps[3]!.id);
      const waiting = await db
        .select()
        .from(applicationsTable)
        .where(
          and(
            eq(applicationsTable.jobId, job.id),
            eq(applicationsTable.state, "WAITLISTED"),
          ),
        );
      const positions = waiting.map((w) => w.queuePosition!).sort((a, b) => a - b);
      const expected = Array.from({ length: positions.length }, (_, i) => i + 1);
      expect(positions).toEqual(expected);
    });
  });
});
