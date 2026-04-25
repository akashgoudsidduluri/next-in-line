import { sql, eq } from "drizzle-orm";
import { db, jobsTable, eventLogsTable } from "@workspace/db";
import { toJobDto, toEventLogDto, type JobDto } from "./dto";
import { withTransaction } from "../lib/transaction";
import { logger } from "../lib/logger";

export interface JobWithCounts {
  id: string;
  title: string;
  capacity: number;
  decaySeconds: number;
  createdAt: string;
  activeCount: number;
  waitlistCount: number;
}

export async function listJobsWithCounts(): Promise<JobWithCounts[]> {
  const rows = await db.execute<{
    id: string;
    title: string;
    capacity: number;
    decay_seconds: number;
    created_at: Date;
    active_count: string;
    waitlist_count: string;
  }>(sql`
    SELECT j.id, j.title, j.capacity, j.decay_seconds, j.created_at,
      COALESCE(SUM(CASE WHEN a.state = 'ACTIVE' THEN 1 ELSE 0 END), 0)::text AS active_count,
      COALESCE(SUM(CASE WHEN a.state = 'WAITLISTED' THEN 1 ELSE 0 END), 0)::text AS waitlist_count
    FROM jobs j
    LEFT JOIN applications a ON a.job_id = j.id
    GROUP BY j.id
    ORDER BY j.created_at DESC
  `);

  return rows.rows.map((r) => ({
    id: r.id,
    title: r.title,
    capacity: Number(r.capacity),
    decaySeconds: Number(r.decay_seconds),
    createdAt: new Date(r.created_at).toISOString(),
    activeCount: Number(r.active_count),
    waitlistCount: Number(r.waitlist_count),
  }));
}

export interface CreateJobInput {
  title: string;
  capacity: number;
  decaySeconds: number;
  companyId: string;
}

export async function createJob(input: CreateJobInput) {
  return withTransaction(async (tx) => {
    logger.info({ title: input.title, companyId: input.companyId }, "Creating new job");
    const [job] = await tx
      .insert(jobsTable)
      .values({
        title: input.title,
        capacity: input.capacity,
        decaySeconds: input.decaySeconds,
        companyId: input.companyId,
      })
      .returning();
    
    if (!job) throw new Error("Failed to create job");
    return toJobDto(job);
  });
}

export async function getJobById(jobId: string): Promise<JobDto | null> {
  const job = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId))
    .limit(1);
  return job[0] ? toJobDto(job[0]) : null;
}

export async function getJobEvents(jobId: string) {
  const rows = await db
    .select()
    .from(eventLogsTable)
    .where(eq(eventLogsTable.jobId, jobId))
    .orderBy(sql`created_at DESC`);
  return rows.map(toEventLogDto);
}
