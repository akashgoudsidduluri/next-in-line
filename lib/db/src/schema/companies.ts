import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const companiesTable = pgTable(
  "companies",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("companies_email_uq").on(t.email)],
);

export type Company = typeof companiesTable.$inferSelect;
export type InsertCompany = typeof companiesTable.$inferInsert;
