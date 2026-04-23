import { describe, it, expect, beforeEach } from "vitest";
import { sql, eq } from "drizzle-orm";
import { db, jobsTable, applicationsTable } from "@workspace/db";
import {
  applyToJob,
  decayActiveApplication,
  findExpiredActiveApplicationIds,
} from "../services/queueEngine";
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
    // Use 2 applicants so the cascade after decay does NOT immediately
    // re-promote the same applicant. With B in line, A lands on the waitlist
    // and B is promoted into A's freed slot.
    const job = await makeJob(1);
    const a = await applyToJob({ jobId: job.id, name: "A", email: uniqEmail() });
    const b = await applyToJob({ jobId: job.id, name: "B", email: uniqEmail() });
    expect(a.state).toBe("ACTIVE");
    expect(b.state).toBe("WAITLISTED");
    await expireDeadline(a.id);

    const expired = await findExpiredActiveApplicationIds();
    expect(expired).toContain(a.id);

    const decayed = await decayActiveApplication(a.id);
    expect(decayed).toBe(true);

    const after = await db
      .select()
      .from(applicationsTable)
      .where(eq(applicationsTable.id, a.id));
    expect(after[0]!.state).toBe("WAITLISTED");
    expect(after[0]!.decayCount).toBe(1);
    expect(after[0]!.queuePosition).not.toBeNull();
    expect(after[0]!.acknowledgedAt).toBeNull();
  });

  it("cascade-promotes the next waitlist head into the freed slot", async () => {
    const job = await makeJob(1);
    const a = await applyToJob({ jobId: job.id, name: "A", email: uniqEmail() });
    const b = await applyToJob({ jobId: job.id, name: "B", email: uniqEmail() });
    expect(b.state).toBe("WAITLISTED");
    await expireDeadline(a.id);
    await decayActiveApplication(a.id);
    const bAfter = await db
      .select()
      .from(applicationsTable)
      .where(eq(applicationsTable.id, b.id));
    expect(bAfter[0]!.state).toBe("ACTIVE");
  });

  it("idempotent — re-decaying after the row is no longer ACTIVE returns false", async () => {
    const job = await makeJob(1);
    const a = await applyToJob({ jobId: job.id, name: "A", email: uniqEmail() });
    await expireDeadline(a.id);
    expect(await decayActiveApplication(a.id)).toBe(true);
    expect(await decayActiveApplication(a.id)).toBe(false);
  });

  it("no-ops when applicant ack'd just before decay (race window)", async () => {
    const job = await makeJob(1);
    const a = await applyToJob({ jobId: job.id, name: "A", email: uniqEmail() });
    await expireDeadline(a.id);
    await db
      .update(applicationsTable)
      .set({ acknowledgedAt: new Date(), ackDeadline: null })
      .where(eq(applicationsTable.id, a.id));
    expect(await decayActiveApplication(a.id)).toBe(false);
  });
});
