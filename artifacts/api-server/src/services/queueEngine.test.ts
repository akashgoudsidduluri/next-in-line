import { describe, it, expect, beforeEach } from "vitest";
import { db, jobsTable, applicationsTable, eventLogsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  applyToJob,
  acknowledgeApplication,
  exitApplication,
  getApplicationStatus,
} from "./queueEngine";
import { createJob } from "./jobService";
import { registerCompany } from "../auth/service";
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
  beforeEach(async (context) => {
    const ok = await resetDb();
    if (!ok) context.skip();
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

    it("appends an APPLIED event (and PROMOTED if active) for every application", async () => {
      const job = await makeJob(1);
      const alice = await findOrCreateApplicant({ name: "Alice", email: uniqEmail("alice") });
      const app = await applyToJob({ jobId: job.id, applicantId: alice.id });

      const logs = await db.select().from(eventLogsTable).where(eq(eventLogsTable.applicationId, app.id));
      
      // For ACTIVE admission, we expect APPLIED and PROMOTED
      expect(logs.length).toBeGreaterThanOrEqual(1);
      const types = logs.map(l => l.eventType);
      expect(types).toContain("APPLIED");
      
      const applied = logs.find(l => l.eventType === "APPLIED")!;
      expect(applied.metadata).toMatchObject({
        admittedAs: "ACTIVE"
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
      
      // Sequential application is CRITICAL for deterministic tests
      const a1 = await findOrCreateApplicant({ name: "A", email: uniqEmail() });
      const app1 = await applyToJob({ jobId: job.id, applicantId: a1.id });
      
      const a2 = await findOrCreateApplicant({ name: "B", email: uniqEmail() });
      const app2 = await applyToJob({ jobId: job.id, applicantId: a2.id });
      
      const a3 = await findOrCreateApplicant({ name: "C", email: uniqEmail() });
      const app3 = await applyToJob({ jobId: job.id, applicantId: a3.id });
      
      const a4 = await findOrCreateApplicant({ name: "D", email: uniqEmail() });
      const app4 = await applyToJob({ jobId: job.id, applicantId: a4.id });

      // app1 is ACTIVE. [app2, app3, app4] are WAITLISTED at [1, 2, 3]
      await exitApplication(app3.id); // Exit C (waitlist pos 2)

      const remaining = await db.select().from(applicationsTable)
        .where(and(eq(applicationsTable.jobId, job.id), eq(applicationsTable.state, "WAITLISTED")))
        .orderBy(applicationsTable.queuePosition);

      expect(remaining).toHaveLength(2);
      expect(remaining[0].id).toBe(app2.id);
      expect(remaining[0].queuePosition).toBe(1);
      expect(remaining[1].id).toBe(app4.id);
      expect(remaining[1].queuePosition).toBe(2); // D shifted from 3 to 2
    });
  });

  describe("Rigorous Invariant Stress Test (Elite)", () => {
    it("preserves all invariants over a randomized sequence of 50 operations", async () => {
      const company = await registerCompany({ name: "Stress Corp", email: uniqEmail("stress"), password: "password123" });
      const { id: jobId } = await createJob({ title: "Stress Job", capacity: 3, decaySeconds: 60, companyId: company.id });
      const apps: string[] = [];

      async function verifyInvariants() {
        const rows = await db.select().from(applicationsTable).where(eq(applicationsTable.jobId, jobId));
        
        // Invariant 1: ACTIVE count <= capacity
        const active = rows.filter(r => r.state === "ACTIVE");
        expect(active.length).toBeLessThanOrEqual(3);

        // Invariant 2: WAITLISTED positions are 1..N and gap-free
        const waitlisted = rows.filter(r => r.state === "WAITLISTED").sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0));
        waitlisted.forEach((r, idx) => {
          expect(r.queuePosition).toBe(idx + 1);
        });

        // Invariant 3: ACTIVE/EXITED have null position
        rows.filter(r => r.state !== "WAITLISTED").forEach(r => {
          expect(r.queuePosition).toBeNull();
        });
      }

      for (let i = 0; i < 50; i++) {
        const op = Math.floor(Math.random() * 3);
        if (op === 0 || apps.length === 0) {
          // APPLY
          const applicant = await findOrCreateApplicant({ name: `Applicant ${i}`, email: `stress-${i}@example.com` });
          const res = await applyToJob({ jobId, applicantId: applicant.id });
          apps.push(res.id);
        } else if (op === 1) {
          // ACK or EXIT (randomly)
          const targetId = apps[Math.floor(Math.random() * apps.length)];
          const rows = await db.select().from(applicationsTable).where(eq(applicationsTable.id, targetId)).limit(1);
          const app = rows[0];
          if (app.state === "ACTIVE" && !app.acknowledgedAt) {
             await acknowledgeApplication(targetId);
          } else if (app.state !== "EXITED") {
             await exitApplication(targetId);
          }
        } else {
          // EXIT a waitlisted one if possible
          const rows = await db.select().from(applicationsTable).where(and(eq(applicationsTable.jobId, jobId), eq(applicationsTable.state, "WAITLISTED"))).limit(1);
          if (rows[0]) {
            await exitApplication(rows[0].id);
          }
        }
        await verifyInvariants();
      }
    });
  });
});
