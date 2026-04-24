import { describe, it, expect, beforeEach } from "vitest";
import { db, jobsTable, applicationsTable, eventLogsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  applyToJob,
  acknowledgeApplication,
  exitApplication,
  getApplicationStatus,
} from "./queueEngine";
import { findOrCreateApplicant } from "./applicantService";
import { resetDb, uniqEmail } from "../__tests__/resetDb";
import { NotFoundError, ConflictError } from "../lib/errors";

async function makeJob(capacity = 2, decaySeconds = 600) {
  const [job] = await db
    .insert(jobsTable)
    .values({ title: "Test", capacity, decaySeconds })
    .returning();
  return job!;
}

describe("QueueEngine Core", () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe("applyToJob", () => {
    it("admits up to capacity as ACTIVE, rest WAITLISTED with sequential positions", async () => {
      const job = await makeJob(2);
      
      const alice = await findOrCreateApplicant({ name: "Alice", email: uniqEmail("alice") });
      const a1 = await applyToJob({ jobId: job.id, applicantId: alice.id });
      
      const bob = await findOrCreateApplicant({ name: "Bob", email: uniqEmail("bob") });
      const a2 = await applyToJob({ jobId: job.id, applicantId: bob.id });
      
      const charlie = await findOrCreateApplicant({ name: "Charlie", email: uniqEmail("charlie") });
      const a3 = await applyToJob({ jobId: job.id, applicantId: charlie.id });
      
      const david = await findOrCreateApplicant({ name: "David", email: uniqEmail("david") });
      const a4 = await applyToJob({ jobId: job.id, applicantId: david.id });

      // State Assertions
      expect(a1.state).toBe("ACTIVE");
      expect(a2.state).toBe("ACTIVE");
      expect(a3.state).toBe("WAITLISTED");
      expect(a4.state).toBe("WAITLISTED");

      // Position Assertions
      expect(a1.queuePosition).toBeNull();
      expect(a3.queuePosition).toBe(1);
      expect(a4.queuePosition).toBe(2);
    });

    it("appends an APPLIED event for every application with correct metadata", async () => {
      const job = await makeJob(1);
      const alice = await findOrCreateApplicant({ name: "Alice", email: uniqEmail("alice") });
      const app = await applyToJob({ jobId: job.id, applicantId: alice.id });

      const logs = await db.select().from(eventLogsTable).where(eq(eventLogsTable.applicationId, app.id));
      expect(logs).toHaveLength(1);
      expect(logs[0].eventType).toBe("APPLIED");
      expect(logs[0].metadata).toMatchObject({
        admittedAs: "ACTIVE",
        capacityAtTime: 1
      });
    });
  });

  describe("acknowledgeApplication", () => {
    it("clears the ack deadline and records acknowledgedAt", async () => {
      const job = await makeJob(1);
      const alice = await findOrCreateApplicant({ name: "Alice", email: uniqEmail("alice") });
      const app = await applyToJob({ jobId: job.id, applicantId: alice.id });
      
      expect(app.ackDeadline).not.toBeNull();
      
      const acked = await acknowledgeApplication(app.id);
      expect(acked.acknowledgedAt).not.toBeNull();
      expect(acked.ackDeadline).toBeNull();

      const [log] = await db.select().from(eventLogsTable).where(
        and(eq(eventLogsTable.applicationId, app.id), eq(eventLogsTable.eventType, "ACKNOWLEDGED"))
      );
      expect(log).toBeDefined();
    });

    it("throws a ConflictError when acknowledging a WAITLISTED application", async () => {
      const job = await makeJob(1);
      const alice = await findOrCreateApplicant({ name: "Alice", email: uniqEmail("alice") });
      await applyToJob({ jobId: job.id, applicantId: alice.id });
      
      const bob = await findOrCreateApplicant({ name: "Bob", email: uniqEmail("bob") });
      const app2 = await applyToJob({ jobId: job.id, applicantId: bob.id });
      
      await expect(acknowledgeApplication(app2.id)).rejects.toThrow(ConflictError);
    });
  });

  describe("exitApplication", () => {
    it("sets state to EXITED and promotes the head of waitlist if under capacity", async () => {
      const job = await makeJob(1);
      
      const alice = await findOrCreateApplicant({ name: "Alice", email: uniqEmail("alice") });
      const a1 = await applyToJob({ jobId: job.id, applicantId: alice.id });
      
      const bob = await findOrCreateApplicant({ name: "Bob", email: uniqEmail("bob") });
      const a2 = await applyToJob({ jobId: job.id, applicantId: bob.id });
      
      expect(a2.state).toBe("WAITLISTED");

      const result = await exitApplication(a1.id);
      expect(result.application.state).toBe("EXITED");

      // Verify Promotion
      const [promoted] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, a2.id));
      expect(promoted.state).toBe("ACTIVE");
      expect(promoted.queuePosition).toBeNull();
      expect(promoted.ackDeadline).not.toBeNull();

      const logs = await db.select().from(eventLogsTable).where(eq(eventLogsTable.applicationId, a2.id));
      expect(logs.some(l => l.eventType === "PROMOTED")).toBe(true);
    });

    it("maintains gap-free waitlist after exit", async () => {
      const job = await makeJob(1);
      const applicants = await Promise.all([
        findOrCreateApplicant({ name: "A", email: uniqEmail() }),
        findOrCreateApplicant({ name: "B", email: uniqEmail() }),
        findOrCreateApplicant({ name: "C", email: uniqEmail() }),
        findOrCreateApplicant({ name: "D", email: uniqEmail() }),
      ]);

      const apps = await Promise.all(applicants.map(a => applyToJob({ jobId: job.id, applicantId: a.id })));
      
      // apps[0] is ACTIVE. [1,2,3] are WAITLISTED at [1,2,3]
      await exitApplication(apps[2].id); // Exit C (waitlist pos 2)

      const remaining = await db.select().from(applicationsTable)
        .where(and(eq(applicationsTable.jobId, job.id), eq(applicationsTable.state, "WAITLISTED")))
        .orderBy(applicationsTable.queuePosition);

      expect(remaining).toHaveLength(2);
      expect(remaining[0].id).toBe(apps[1].id);
      expect(remaining[0].queuePosition).toBe(1);
      expect(remaining[1].id).toBe(apps[3].id);
      expect(remaining[1].queuePosition).toBe(2); // D shifted from 3 to 2
    });
  });
});
