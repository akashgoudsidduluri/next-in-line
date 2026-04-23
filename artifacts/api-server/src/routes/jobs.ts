import { Router, type IRouter } from "express";
import { sql, eq } from "drizzle-orm";
import { db, jobsTable } from "@workspace/db";
import { CreateJobBody } from "@workspace/api-zod";
import { toJobDto } from "../services/dto";

const router: IRouter = Router();

router.get("/jobs", async (_req, res, next) => {
  try {
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
    res.json(
      rows.rows.map((r) => ({
        id: r.id,
        title: r.title,
        capacity: Number(r.capacity),
        decaySeconds: Number(r.decay_seconds),
        createdAt: new Date(r.created_at).toISOString(),
        activeCount: Number(r.active_count),
        waitlistCount: Number(r.waitlist_count),
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.post("/jobs", async (req, res, next) => {
  try {
    const body = CreateJobBody.parse(req.body);
    const [job] = await db
      .insert(jobsTable)
      .values({
        title: body.title,
        capacity: body.capacity,
        decaySeconds: body.decaySeconds ?? 600,
      })
      .returning();
    if (!job) throw new Error("Failed to create job");
    res.status(201).json(toJobDto(job));
  } catch (err) {
    next(err);
  }
});

router.get("/jobs/:jobId", async (req, res, next) => {
  try {
    const jobId = req.params["jobId"]!;
    const { getJobDashboard } = await import("../services/queueEngine");
    const dash = await getJobDashboard(jobId);
    if (!dash) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const { toDashboardApplicationDto, toEventLogDto } = await import(
      "../services/dto"
    );
    res.json({
      job: {
        ...toJobDto(dash.job),
        activeCount: dash.activeCount,
        waitlistCount: dash.waitlistCount,
      },
      active: dash.active.map((a) =>
        toDashboardApplicationDto(a.app, a.applicant),
      ),
      waitlist: dash.waitlist.map((a) =>
        toDashboardApplicationDto(a.app, a.applicant),
      ),
      recentEvents: dash.recentEvents.map(toEventLogDto),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/jobs/:jobId/events", async (req, res, next) => {
  try {
    const jobId = req.params["jobId"]!;
    const { eventLogsTable } = await import("@workspace/db");
    const rows = await db
      .select()
      .from(eventLogsTable)
      .where(eq(eventLogsTable.jobId, jobId))
      .orderBy(sql`created_at DESC`);
    const { toEventLogDto } = await import("../services/dto");
    res.json(rows.map(toEventLogDto));
  } catch (err) {
    next(err);
  }
});

export default router;
