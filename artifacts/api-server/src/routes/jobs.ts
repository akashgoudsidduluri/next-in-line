import { Router, type IRouter } from "express";
import {
  CreateJobBody,
  JobIdParams,
  ReplayJobQuery,
} from "@workspace/api-zod";
import {
  getJobDashboard,
  jobBelongsToCompany,
} from "../services/queueEngine";
import { replayJob } from "../services/replay";
import * as jobService from "../services/jobService";
import { requireCompany, getCompanyAuth } from "../auth/middleware";
import { ForbiddenError, NotFoundError } from "../lib/errors";

export const jobsRouter: IRouter = Router();

/** Public — list jobs with live counts so applicants can browse. */
jobsRouter.get("/jobs", async (req, res, next) => {
  try {
    const title = req.query.title as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const jobs = await jobService.listJobsWithCounts({
      companyId: undefined,
      title,
      limit,
      offset,
    });
    res.json(jobs);
  } catch (err) {
    next(err);
  }
});

/** Company — list only MY jobs with live counts. */
jobsRouter.get("/jobs/me", requireCompany, async (req, res, next) => {
  try {
    const auth = getCompanyAuth(req);
    const jobs = await jobService.listJobsWithCounts({ companyId: auth.companyId });
    res.json(jobs);
  } catch (err) {
    next(err);
  }
});

jobsRouter.post("/jobs", requireCompany, async (req, res, next) => {
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

jobsRouter.get("/jobs/:jobId", requireCompany, async (req, res, next) => {
  try {
    const { jobId } = JobIdParams.parse(req.params);
    const auth = getCompanyAuth(req);
    const owns = await jobBelongsToCompany(jobId, auth.companyId);
    if (!owns) throw new ForbiddenError("Not your job");

    const dash = await getJobDashboard(jobId);
    if (!dash) throw new NotFoundError("Job not found");
    res.json(dash);
  } catch (err) {
    next(err);
  }
});

jobsRouter.get("/jobs/:jobId/events", requireCompany, async (req, res, next) => {
  try {
    const { jobId } = JobIdParams.parse(req.params);
    const auth = getCompanyAuth(req);
    const owns = await jobBelongsToCompany(jobId, auth.companyId);
    if (!owns) throw new ForbiddenError("Not your job");

    const events = await jobService.getJobEvents(jobId);
    res.json(events);
  } catch (err) {
    next(err);
  }
});

jobsRouter.get("/jobs/:jobId/replay", requireCompany, async (req, res, next) => {
  try {
    const { jobId } = JobIdParams.parse(req.params);
    const { asOf } = ReplayJobQuery.parse(req.query);
    const auth = getCompanyAuth(req);
    const owns = await jobBelongsToCompany(jobId, auth.companyId);
    if (!owns) throw new ForbiddenError("Not your job");

    const result = await replayJob(jobId, asOf);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default jobsRouter;
