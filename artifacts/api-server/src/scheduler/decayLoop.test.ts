import { describe, it, expect, beforeEach } from "vitest";
import { sql, eq } from "drizzle-orm";
import { db, jobsTable, applicationsTable } from "@workspace/db";
import {
  applyToJob,
  decayActiveApplication,
  findExpiredActiveApplicationIds,
} from "../services/queueEngine";
import { findOrCreateApplicant } from "../services/applicantService";
import { resetDb, uniqEmail } from "../__tests__/resetDb";

async function makeJob(capacity = 1, decaySeconds = 600) {
  const [j] = await db
    .insert(jobsTable)
    .values({ title: "T", capacity, decaySeconds })
    .returning();
  return j!;
}

async function expireDeadline(applicationId: string) {
  await db.execute(
    sql`UPDATE applications SET ack_deadline = NOW() - INTERVAL '1 minute' WHERE id = ${applicationId}`,
  );
}

describe("decayLoop", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("decays an unacknowledged ACTIVE applicant whose deadline has passed", async () => {
    const job = await makeJob(1);
    const a1 = await findOrCreateApplicant({ name: "A", email: uniqEmail() });
    const a2 = await findOrCreateApplicant({ name: "B", email: uniqEmail() });
    
    const a = await applyToJob({ jobId: job.id, applicantId: a1.id });
    const b = await applyToJob({ jobId: job.id, applicantId: a2.id });
    
    expect(a.state).toBe("ACTIVE");
    expect(b.state).toBe("WAITLISTED");
    expect(b.queuePosition).toBe(1);
    
    await expireDeadline(a.id);

    const expired = await findExpiredActiveApplicationIds();
    expect(expired).toContain(a.id);

    const success = await decayActiveApplication(a.id);
    expect(success).toBe(true);

    const appA = (await db.select().from(applicationsTable).where(eq(applicationsTable.id, a.id)))[0]!;
    const appB = (await db.select().from(applicationsTable).where(eq(applicationsTable.id, b.id)))[0]!;

    expect(appA.state).toBe("WAITLISTED");
    expect(appA.decayCount).toBe(1);
    expect(appA.queuePosition).toBe(1); // Back of line (only one in list)
    expect(appA.acknowledgedAt).toBeNull();
    expect(appA.ackDeadline).toBeNull();

    expect(appB.state).toBe("ACTIVE");
    expect(appB.queuePosition).toBeNull();
    expect(appB.ackDeadline).not.toBeNull();
  });

  it("handles multiple decay cycles correctly (accumulation of penalty)", async () => {
    const job = await makeJob(1);
    const [idA, idB, idC] = await Promise.all([
      findOrCreateApplicant({ name: "A", email: uniqEmail() }),
      findOrCreateApplicant({ name: "B", email: uniqEmail() }),
      findOrCreateApplicant({ name: "C", email: uniqEmail() }),
    ]);

    const a = await applyToJob({ jobId: job.id, applicantId: idA.id });
    const b = await applyToJob({ jobId: job.id, applicantId: idB.id });
    const c = await applyToJob({ jobId: job.id, applicantId: idC.id });

    // 1st Decay: A (ACTIVE) -> B (Promoted)
    await expireDeadline(a.id);
    await decayActiveApplication(a.id);
    
    let state = await db.select().from(applicationsTable).orderBy(applicationsTable.createdAt);
    expect(state.find(x => x.id === a.id)?.decayCount).toBe(1);
    expect(state.find(x => x.id === b.id)?.state).toBe("ACTIVE");

    // 2nd Decay: B (ACTIVE) -> C (Promoted)
    await expireDeadline(b.id);
    await decayActiveApplication(b.id);

    state = await db.select().from(applicationsTable);
    expect(state.find(x => x.id === b.id)?.decayCount).toBe(1);
    expect(state.find(x => x.id === c.id)?.state).toBe("ACTIVE");
    expect(state.find(x => x.id === a.id)?.queuePosition).toBe(1);
    expect(state.find(x => x.id === b.id)?.queuePosition).toBe(2);

    // 3rd Decay: C (ACTIVE) -> A (Promoted)
    await expireDeadline(c.id);
    await decayActiveApplication(c.id);

    state = await db.select().from(applicationsTable);
    expect(state.find(x => x.id === a.id)?.state).toBe("ACTIVE");
    expect(state.find(x => x.id === a.id)?.decayCount).toBe(1);
    expect(state.find(x => x.id === c.id)?.decayCount).toBe(1);
    expect(state.find(x => x.id === c.id)?.queuePosition).toBe(2);
  });

  it("idempotent — re-decaying returns false and preserves state", async () => {
    const job = await makeJob(1);
    const ident = await findOrCreateApplicant({ name: "A", email: uniqEmail() });
    const a = await applyToJob({ jobId: job.id, applicantId: ident.id });
    await expireDeadline(a.id);
    
    expect(await decayActiveApplication(a.id)).toBe(true);
    const firstState = await db.select().from(applicationsTable).where(eq(applicationsTable.id, a.id));
    
    expect(await decayActiveApplication(a.id)).toBe(false);
    const secondState = await db.select().from(applicationsTable).where(eq(applicationsTable.id, a.id));
    
    expect(firstState).toEqual(secondState);
  });

  it("prevents decay if applicant acknowledged in the race window", async () => {
    const job = await makeJob(1);
    const ident = await findOrCreateApplicant({ name: "A", email: uniqEmail() });
    const a = await applyToJob({ jobId: job.id, applicantId: ident.id });
    await expireDeadline(a.id);
    
    // Simulate concurrent ACK
    const now = new Date();
    await db
      .update(applicationsTable)
      .set({ acknowledgedAt: now, ackDeadline: null })
      .where(eq(applicationsTable.id, a.id));
      
    const result = await decayActiveApplication(a.id);
    expect(result).toBe(false);

    const final = (await db.select().from(applicationsTable).where(eq(applicationsTable.id, a.id)))[0]!;
    expect(final.state).toBe("ACTIVE");
    expect(final.acknowledgedAt?.toISOString()).toBe(now.toISOString());
  });

  it("handles multiple simultaneous decays by promoting sequentially", async () => {
    const job = await makeJob(2);
    const [a1, a2, a3, a4] = await Promise.all([
      findOrCreateApplicant({ name: "1", email: uniqEmail() }),
      findOrCreateApplicant({ name: "2", email: uniqEmail() }),
      findOrCreateApplicant({ name: "3", email: uniqEmail() }),
      findOrCreateApplicant({ name: "4", email: uniqEmail() }),
    ]);

    const apps = await Promise.all([
      applyToJob({ jobId: job.id, applicantId: a1.id }),
      applyToJob({ jobId: job.id, applicantId: a2.id }),
      applyToJob({ jobId: job.id, applicantId: a3.id }),
      applyToJob({ jobId: job.id, applicantId: a4.id }),
    ]);

    // apps[0], apps[1] are ACTIVE. apps[2], apps[3] are WAITLISTED.
    await expireDeadline(apps[0].id);
    await expireDeadline(apps[1].id);

    // Decay both
    await Promise.all([
      decayActiveApplication(apps[0].id),
      decayActiveApplication(apps[1].id),
    ]);

    const finalState = await db.select().from(applicationsTable).where(eq(applicationsTable.jobId, job.id));
    
    // Both 3 and 4 should be ACTIVE now
    expect(finalState.find(x => x.id === apps[2].id)?.state).toBe("ACTIVE");
    expect(finalState.find(x => x.id === apps[3].id)?.state).toBe("ACTIVE");
    
    // 1 and 2 should be at the back of the waitlist
    const waitlisted = finalState.filter(x => x.state === "WAITLISTED").sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0));
    expect(waitlisted).toHaveLength(2);
    expect(waitlisted[0].id).toBe(apps[0].id);
    expect(waitlisted[1].id).toBe(apps[1].id);
  });

  it("handles capacity increase by promoting waitlist immediately", async () => {
    const job = await makeJob(1);
    const [a1, a2] = await Promise.all([
      findOrCreateApplicant({ name: "1", email: uniqEmail() }),
      findOrCreateApplicant({ name: "2", email: uniqEmail() }),
    ]);

    await applyToJob({ jobId: job.id, applicantId: a1.id });
    const b = await applyToJob({ jobId: job.id, applicantId: a2.id });

    expect(b.state).toBe("WAITLISTED");

    // Increase capacity from 1 to 2
    const { updateJob } = await import("../services/queueEngine");
    await updateJob(job.id, { capacity: 2 });

    const appB = (await db.select().from(applicationsTable).where(eq(applicationsTable.id, b.id)))[0]!;
    expect(appB.state).toBe("ACTIVE");
    expect(appB.queuePosition).toBeNull();
  });
});

