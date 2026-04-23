import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companiesTable } from "./companies";

export const jobsTable = pgTable(
  "jobs",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    title: text("title").notNull(),
    capacity: integer("capacity").notNull(),
    decaySeconds: integer("decay_seconds").notNull().default(600),
    /** Nullable to preserve legacy jobs created before auth. */
    companyId: text("company_id").references(() => companiesTable.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("jobs_company_idx").on(t.companyId)],
);

export type Job = typeof jobsTable.$inferSelect;
export type InsertJob = typeof jobsTable.$inferInsert;
