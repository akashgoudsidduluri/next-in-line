import {
  pgTable,
  text,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { jobsTable } from "./jobs";
import { applicantsTable } from "./applicants";

/**
 * Application state machine — every application is in exactly one of these:
 *   WAITLISTED — in the ordered queue with a 1-based queue_position
 *   ACTIVE     — in the bounded active set; ack_deadline is set until ack'd
 *   EXITED     — terminal state; queue_position is null
 */
export const APPLICATION_STATES = ["WAITLISTED", "ACTIVE", "EXITED"] as const;
export type ApplicationState = (typeof APPLICATION_STATES)[number];

export const applicationsTable = pgTable(
  "applications",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    jobId: text("job_id")
      .notNull()
      .references(() => jobsTable.id, { onDelete: "cascade" }),
    applicantId: text("applicant_id")
      .notNull()
      .references(() => applicantsTable.id, { onDelete: "cascade" }),
    state: text("state").notNull().$type<ApplicationState>(),
    /** 1-based queue position when WAITLISTED; null otherwise. */
    queuePosition: integer("queue_position"),
    /** Set when promoted to ACTIVE; cleared on acknowledge. */
    ackDeadline: timestamp("ack_deadline", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    /** How many times this application has decayed back to the waitlist. */
    decayCount: integer("decay_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Strict gap-free queue ordering per job.
    uniqueIndex("applications_queue_position_uq").on(t.jobId, t.queuePosition),
    index("applications_job_state_idx").on(t.jobId, t.state),
    index("applications_ack_deadline_idx").on(t.ackDeadline),
  ],
);

export type Application = typeof applicationsTable.$inferSelect;
export type InsertApplication = typeof applicationsTable.$inferInsert;
