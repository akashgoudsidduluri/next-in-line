import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { jobsTable } from "./jobs";
import { applicationsTable } from "./applications";

/**
 * Event log — append-only audit of every state transition.
 * The current state of any application can be reconstructed purely from the log.
 */
export const EVENT_TYPES = [
  "APPLIED",
  "PROMOTED",
  "ACKNOWLEDGED",
  "DECAYED",
  "EXITED",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const eventLogsTable = pgTable(
  "event_logs",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    applicationId: text("application_id")
      .notNull()
      .references(() => applicationsTable.id, { onDelete: "cascade" }),
    jobId: text("job_id")
      .notNull()
      .references(() => jobsTable.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull().$type<EventType>(),
    metadata: jsonb("metadata").notNull().default({}),
    schemaVersion: text("schema_version").notNull().default("v1"),
    correlationId: text("correlation_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("event_logs_job_idx").on(t.jobId, t.createdAt),
    index("event_logs_application_idx").on(t.applicationId, t.createdAt),
  ],
);

export type EventLog = typeof eventLogsTable.$inferSelect;
export type InsertEventLog = typeof eventLogsTable.$inferInsert;
