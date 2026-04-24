/**
 * Pure event-log replay.
 *
 * Reconstructs the queue state of a job at an arbitrary point in time using
 * ONLY the append-only event_logs table — never the live applications/jobs
 * row state. This is the proof that the event log is a true source of truth.
 *
 * The replay surfaces the synthetic states required by the contract:
 *   ACTIVE                    — promoted and acknowledged at <= asOf
 *   PENDING_ACKNOWLEDGMENT    — promoted but not yet acknowledged at asOf
 *   WAITLISTED                — currently in the ordered queue
 *   INACTIVE                  — exited before asOf
 */

import { sql, and, eq, lte, inArray } from "drizzle-orm";
import {
  db,
  eventLogsTable,
  applicantsTable,
  applicationsTable,
  type EventLog,
} from "@workspace/db";

export type ReplayState =
  | "ACTIVE"
  | "PENDING_ACKNOWLEDGMENT"
  | "WAITLISTED"
  | "INACTIVE";

export interface ReplayApplication {
  applicationId: string;
  applicantName: string | null;
  applicantEmail: string | null;
  state: ReplayState;
  queuePosition: number | null;
  decayCount: number;
  acknowledgedAt: string | null;
  ackDeadline: string | null;
  lastEventAt: string;
}

export interface ReplayResult {
  jobId: string;
  asOf: string;
  applications: ReplayApplication[];
}

interface ReplayRow {
  state: "WAITLISTED" | "ACTIVE" | "EXITED";
  acknowledged: boolean;
  queuePosition: number | null;
  decayCount: number;
  acknowledgedAt: string | null;
  ackDeadline: string | null;
  lastEventAt: string;
}

/**
 * Pure reducer — apply one event to a per-application state object.
 * Exported for direct unit testing.
 */
export function reduceEvent(
  prev: ReplayRow | undefined,
  event: Pick<EventLog, "eventType" | "metadata" | "createdAt">,
): ReplayRow {
  const meta = (event.metadata ?? {}) as Record<string, unknown>;
  const at = event.createdAt.toISOString();
  const base: ReplayRow = prev ?? {
    state: "WAITLISTED",
    acknowledged: false,
    queuePosition: null,
    decayCount: 0,
    acknowledgedAt: null,
    ackDeadline: null,
    lastEventAt: at,
  };
  switch (event.eventType) {
    case "APPLIED": {
      const admittedAs = meta["admittedAs"] === "ACTIVE" ? "ACTIVE" : "WAITLISTED";
      return {
        ...base,
        state: admittedAs,
        acknowledged: false,
        queuePosition:
          admittedAs === "WAITLISTED"
            ? Number(meta["queuePosition"] ?? null) || null
            : null,
        ackDeadline:
          admittedAs === "ACTIVE"
            ? (meta["ackDeadline"] as string) ?? null
            : null,
        lastEventAt: at,
      };
    }
    case "PROMOTED":
      return {
        ...base,
        state: "ACTIVE",
        acknowledged: false,
        queuePosition: null,
        ackDeadline: (meta["ackDeadline"] as string) ?? null,
        lastEventAt: at,
      };
    case "ACKNOWLEDGED":
      return {
        ...base,
        state: "ACTIVE",
        acknowledged: true,
        ackDeadline: null,
        acknowledgedAt: at,
        lastEventAt: at,
      };
    case "DECAYED":
      return {
        ...base,
        state: "WAITLISTED",
        acknowledged: false,
        queuePosition: Number(meta["newQueuePosition"] ?? null) || null,
        decayCount: Number(meta["decayCount"] ?? base.decayCount + 1),
        ackDeadline: null,
        lastEventAt: at,
      };
    case "EXITED":
      return {
        ...base,
        state: "EXITED",
        queuePosition: null,
        ackDeadline: null,
        lastEventAt: at,
      };
    default:
      return { ...base, lastEventAt: at };
  }
}

/**
 * Pure comparison utility for ReplayApplication sorting.
 * Priorities:
 * 1. ACTIVE
 * 2. PENDING_ACKNOWLEDGMENT
 * 3. WAITLISTED (by queuePosition)
 * 4. INACTIVE
 */
export function compareReplayApplications(a: ReplayApplication, b: ReplayApplication): number {
  const ord = (s: ReplayState) => {
    switch (s) {
      case "ACTIVE": return 0;
      case "PENDING_ACKNOWLEDGMENT": return 1;
      case "WAITLISTED": return 2;
      case "INACTIVE": return 3;
      default: return 4;
    }
  };

  if (ord(a.state) !== ord(b.state)) {
    return ord(a.state) - ord(b.state);
  }

  // Same state: use queuePosition for WAITLISTED
  if (a.state === "WAITLISTED") {
    return (a.queuePosition ?? 0) - (b.queuePosition ?? 0);
  }

  return 0;
}


function externaliseState(row: ReplayRow): ReplayState {
  if (row.state === "EXITED") return "INACTIVE";
  if (row.state === "WAITLISTED") return "WAITLISTED";
  return row.acknowledged ? "ACTIVE" : "PENDING_ACKNOWLEDGMENT";
}

export async function replayJob(
  jobId: string,
  asOf: Date,
): Promise<ReplayResult> {
  const events = await db
    .select()
    .from(eventLogsTable)
    .where(
      and(eq(eventLogsTable.jobId, jobId), lte(eventLogsTable.createdAt, asOf)),
    )
    .orderBy(sql`created_at ASC`);

  const byApp = new Map<string, ReplayRow>();
  for (const e of events) {
    byApp.set(e.applicationId, reduceEvent(byApp.get(e.applicationId), e));
  }

  // Look up applicant identities for the applications we encountered.
  const appIds = [...byApp.keys()];
  const identities = appIds.length
    ? await db
        .select({
          applicationId: applicationsTable.id,
          name: applicantsTable.name,
          email: applicantsTable.email,
        })
        .from(applicationsTable)
        .innerJoin(
          applicantsTable,
          eq(applicantsTable.id, applicationsTable.applicantId),
        )
        .where(inArray(applicationsTable.id, appIds))
    : [];

  const idMap = new Map(identities.map((r) => [r.applicationId, r] as const));

  const applications: ReplayApplication[] = appIds.map((id) => {
    const row = byApp.get(id)!;
    const ident = idMap.get(id);
    return {
      applicationId: id,
      applicantName: ident?.name ?? null,
      applicantEmail: ident?.email ?? null,
      state: externaliseState(row),
      queuePosition: row.state === "WAITLISTED" ? row.queuePosition : null,
      decayCount: row.decayCount,
      acknowledgedAt: row.acknowledgedAt,
      ackDeadline: row.ackDeadline,
      lastEventAt: row.lastEventAt,
    };
  });

  applications.sort(compareReplayApplications);


  return { jobId, asOf: asOf.toISOString(), applications };
}
