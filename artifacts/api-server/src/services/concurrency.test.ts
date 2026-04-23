import { describe, it, expect, beforeEach } from "vitest";
import { db, jobsTable, applicationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { applyToJob, exitApplication } from "./queueEngine";
import { resetDb, uniqEmail } from "../__tests__/resetDb";

async function makeJob(capacity: number) {
  const [j] = await db
    .insert(jobsTable)
    .values({ title: "T", capacity })
    .returning();
  return j!;
}

async function countByState(jobId: string, state: "ACTIVE" | "WAITLISTED") {
  const rows = await db
    .select()
    .from(applicationsTable)
    .where(
      and(eq(applicationsTable.jobId, jobId), eq(applicationsTable.state, state)),
    );
  return rows.length;
}

describe("concurrency (DB-backed; proves lock acquisition)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("two simultaneous applies for the last slot — exactly one ACTIVE, one WAITLISTED", async () => {
    const job = await makeJob(1);
    const [r1, r2] = await Promise.all([
      applyToJob({ jobId: job.id, name: "A", email: uniqEmail() }),
      applyToJob({ jobId: job.id, name: "B", email: uniqEmail() }),
    ]);
    const states = [r1.state, r2.state].sort();
    expect(states).toEqual(["ACTIVE", "WAITLISTED"]);
    expect(await countByState(job.id, "ACTIVE")).toBe(1);
    expect(await countByState(job.id, "WAITLISTED")).toBe(1);
  });

  it("ten simultaneous applies on capacity=3 — exactly 3 ACTIVE and 7 WAITLISTED", async () => {
    const job = await makeJob(3);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        applyToJob({ jobId: job.id, name: "A", email: uniqEmail() }),
      ),
    );
    const active = results.filter((r) => r.state === "ACTIVE");
    const waitlisted = results.filter((r) => r.state === "WAITLISTED");
    expect(active.length).toBe(3);
    expect(waitlisted.length).toBe(7);
    const positions = waitlisted.map((w) => w.queuePosition!).sort((a, b) => a - b);
    expect(positions).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("20 simultaneous applies on capacity=1 never violate capacity", async () => {
    const job = await makeJob(1);
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        applyToJob({ jobId: job.id, name: "A", email: uniqEmail() }),
      ),
    );
    expect(results.filter((r) => r.state === "ACTIVE").length).toBe(1);
    expect(results.filter((r) => r.state === "WAITLISTED").length).toBe(19);
  });

  it("simultaneous exits + applies leave the queue gap-free", async () => {
    const job = await makeJob(1);
    const a = await applyToJob({ jobId: job.id, name: "A", email: uniqEmail() });
    await applyToJob({ jobId: job.id, name: "B", email: uniqEmail() });
    await applyToJob({ jobId: job.id, name: "C", email: uniqEmail() });

    await Promise.all([
      exitApplication(a.id),
      applyToJob({ jobId: job.id, name: "D", email: uniqEmail() }),
      applyToJob({ jobId: job.id, name: "E", email: uniqEmail() }),
    ]);

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
    expect(await countByState(job.id, "ACTIVE")).toBeLessThanOrEqual(1);
  });
});
