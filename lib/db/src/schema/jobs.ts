import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const jobsTable = pgTable("jobs", {
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()::text`),
  title: text("title").notNull(),
  capacity: integer("capacity").notNull(),
  decaySeconds: integer("decay_seconds").notNull().default(600),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Job = typeof jobsTable.$inferSelect;
export type InsertJob = typeof jobsTable.$inferInsert;
