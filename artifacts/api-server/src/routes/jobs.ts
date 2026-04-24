import { Router, type IRouter } from "express";
import { CreateJobBody } from "@workspace/api-zod";
import { toEventLogDto, toDashboardApplicationDto, toJobDto } from "../services/dto";
import { getJobDashboard } from "../services/queueEngine";
import { jobBelongsToCompany } from "../services/queueEngineExt";
import { replayJob } from "../services/replay";
import * as jobService from "../services/jobService";
import { requireCompany, getCompanyAuth } from "../auth/middleware";
import { ForbiddenError, NotFoundError, BadRequestError } from "../lib/errors";

const router: IRouter = Router();

/** Public — list jobs with live counts so applicants can browse. */
router.get("/jobs", async (_req, res, next) => {
  try {
    const jobs = await jobService.listJobsWithCounts();
    res.json(jobs);
  } catch (err) {
    next(err);
  }
});

router.post("/jobs", requireCompany, async (req, res, next) => {
  try {
    const body = CreateJobBody.parse(req.body);
    const auth = getCompanyAuth(req);
    const job = await jobService.createJob({
      title: body.title,
      capacity: body.capacity,
      decaySeconds: body.decaySeconds ?? 600,
      companyId: auth.companyId,
    });
    res.status(201).json(job);
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

    const events = await jobService.getJobEvents(jobId);
    res.json(events);
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
