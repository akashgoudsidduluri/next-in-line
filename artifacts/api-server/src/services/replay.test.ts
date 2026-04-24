import { describe, it, expect, beforeEach } from "vitest";
import { reduceEvent, replayJob } from "./replay";
import {
  applyToJob,
  acknowledgeApplication,
  exitApplication,
} from "./queueEngine";
import { findOrCreateApplicant } from "./applicantService";
import { db, jobsTable } from "@workspace/db";
import { resetDb, uniqEmail } from "../__tests__/resetDb";

describe("replay.reduceEvent (pure)", () => {
  const at = new Date();

  it("APPLIED-as-ACTIVE produces ACTIVE not yet acknowledged", () => {
    const r = reduceEvent(undefined, {
      eventType: "APPLIED",
      metadata: { admittedAs: "ACTIVE", ackDeadline: at.toISOString() },
      createdAt: at,
    });
    expect(r.state).toBe("ACTIVE");
    expect(r.acknowledged).toBe(false);
  });

  it("ACKNOWLEDGED flips acknowledged true", () => {
    const r1 = reduceEvent(undefined, {
      eventType: "APPLIED",
      metadata: { admittedAs: "ACTIVE" },
      createdAt: at,
    });
    const r2 = reduceEvent(r1, {
      eventType: "ACKNOWLEDGED",
      metadata: {},
      createdAt: at,
    });
    expect(r2.acknowledged).toBe(true);
  });

  it("DECAYED moves to WAITLISTED with the new position", () => {
    const r1 = reduceEvent(undefined, {
      eventType: "APPLIED",
      metadata: { admittedAs: "ACTIVE" },
      createdAt: at,
    });
    const r2 = reduceEvent(r1, {
      eventType: "DECAYED",
      metadata: { newQueuePosition: 5, decayCount: 1 },
      createdAt: at,
    });
    expect(r2.state).toBe("WAITLISTED");
    expect(r2.queuePosition).toBe(5);
    expect(r2.decayCount).toBe(1);
  });

  it("EXITED is terminal", () => {
    const r1 = reduceEvent(undefined, {
      eventType: "APPLIED",
      metadata: { admittedAs: "WAITLISTED", queuePosition: 1 },
      createdAt: at,
    });
    const r2 = reduceEvent(r1, {
      eventType: "EXITED",
      metadata: { previousState: "WAITLISTED" },
      createdAt: at,
    });
    expect(r2.state).toBe("EXITED");
  });
});

describe("replay.replayJob (DB)", () => {
  beforeEach(async (context) => {
    const ok = await resetDb();
    if (!ok) context.skip();
  });

  it("reconstructs current state purely from event_logs", async () => {
    const [job] = await db
      .insert(jobsTable)
      .values({ title: "T", capacity: 1 })
      .returning();
      
    const identA = await findOrCreateApplicant({ name: "A", email: uniqEmail("a") });
    const identB = await findOrCreateApplicant({ name: "B", email: uniqEmail("b") });
    
    const a = await applyToJob({ jobId: job!.id, applicantId: identA.id });
    const b = await applyToJob({ jobId: job!.id, applicantId: identB.id });
    await acknowledgeApplication(a.id);

    const replayed = await replayJob(job!.id, new Date());
    const states = Object.fromEntries(
      replayed.applications.map((r) => [r.applicationId, r.state]),
    );
    expect(states[a.id]).toBe("ACTIVE");
    expect(states[b.id]).toBe("WAITLISTED");
  });

  it("returns historical state for an asOf in the past", async () => {
    const [job] = await db
      .insert(jobsTable)
      .values({ title: "T", capacity: 1 })
      .returning();
      
    const identA = await findOrCreateApplicant({ name: "A", email: uniqEmail("a") });
    const a = await applyToJob({ jobId: job!.id, applicantId: identA.id });
    
    await new Promise((r) => setTimeout(r, 50));
    const snapshot = new Date();
    await new Promise((r) => setTimeout(r, 50));
    await exitApplication(a.id);

    const past = await replayJob(job!.id, snapshot);
    const aStateThen = past.applications.find(
      (r) => r.applicationId === a.id,
    )?.state;
    expect(aStateThen).toBe("PENDING_ACKNOWLEDGMENT");

    const now = await replayJob(job!.id, new Date());
    const aStateNow = now.applications.find(
      (r) => r.applicationId === a.id,
    )?.state;
    expect(aStateNow).toBe("INACTIVE");
  });
});
