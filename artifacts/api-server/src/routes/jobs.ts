import { Router, type IRouter } from "express";
import { sql, eq } from "drizzle-orm";
import { db, jobsTable, eventLogsTable } from "@workspace/db";
import { CreateJobBody } from "@workspace/api-zod";
import { toJobDto, toEventLogDto, toDashboardApplicationDto } from "../services/dto";
import { getJobDashboard } from "../services/queueEngine";
import { jobBelongsToCompany } from "../services/queueEngineExt";
import { replayJob } from "../services/replay";
import { requireCompany, getCompanyAuth } from "../auth/middleware";
import { ForbiddenError, NotFoundError, BadRequestError } from "../lib/errors";

const router: IRouter = Router();

/** Public — list jobs with live counts so applicants can browse. */
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

router.post("/jobs", requireCompany, async (req, res, next) => {
  try {
    const body = CreateJobBody.parse(req.body);
    const auth = getCompanyAuth(req);
    const [job] = await db
      .insert(jobsTable)
      .values({
        title: body.title,
        capacity: body.capacity,
        decaySeconds: body.decaySeconds ?? 600,
        companyId: auth.companyId,
      })
      .returning();
    if (!job) throw new Error("Failed to create job");
    res.status(201).json(toJobDto(job));
  } catch (err) {
    next(err);
  }
});

router.get("/jobs/:jobId", requireCompany, async (req, res, next) => {
  try {
    const jobId = String(req.params["jobId"]);
    const auth = getCompanyAuth(req);
    const owns = await jobBelongsToCompany(jobId, auth.companyId);
    if (!owns) throw new ForbiddenError("Not your job");

    const dash = await getJobDashboard(jobId);
    if (!dash) throw new NotFoundError("Job not found");
    res.json({
      job: {
        ...toJobDto(dash.job),
        activeCount: dash.active.length,
        waitlistCount: dash.waitlist.length,
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

router.get("/jobs/:jobId/events", requireCompany, async (req, res, next) => {
  try {
    const jobId = String(req.params["jobId"]);
    const auth = getCompanyAuth(req);
    const owns = await jobBelongsToCompany(jobId, auth.companyId);
    if (!owns) throw new ForbiddenError("Not your job");

    const rows = await db
      .select()
      .from(eventLogsTable)
      .where(eq(eventLogsTable.jobId, jobId))
      .orderBy(sql`created_at DESC`);
    res.json(rows.map(toEventLogDto));
  } catch (err) {
    next(err);
  }
});

router.get("/jobs/:jobId/replay", requireCompany, async (req, res, next) => {
  try {
    const jobId = String(req.params["jobId"]);
    const auth = getCompanyAuth(req);
    const owns = await jobBelongsToCompany(jobId, auth.companyId);
    if (!owns) throw new ForbiddenError("Not your job");

    const asOfRaw = req.query["asOf"];
    if (typeof asOfRaw !== "string") {
      throw new BadRequestError("Query parameter 'asOf' (ISO8601) is required");
    }
    const asOf = new Date(asOfRaw);
    if (Number.isNaN(asOf.getTime())) {
      throw new BadRequestError("Query parameter 'asOf' must be a valid ISO8601 timestamp");
    }
    const result = await replayJob(jobId, asOf);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
