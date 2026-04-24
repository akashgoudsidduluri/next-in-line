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
});
