import { Router, type IRouter } from "express";
import { JobIdParams, ApplicationIdParams } from "@workspace/api-zod";
import {
  acknowledgeApplication,
  exitApplication,
  getApplicationStatus,
  applyAsRegisteredApplicant,
  applicationBelongsToApplicant,
  getMyApplications,
} from "../services/queueEngine";
import { requireApplicant, getApplicantAuth } from "../auth/middleware";
import { ForbiddenError, NotFoundError } from "../lib/errors";

export const applicationsRouter: IRouter = Router();

applicationsRouter.post("/jobs/:jobId/apply", requireApplicant, async (req, res, next) => {
  try {
    const { jobId } = JobIdParams.parse(req.params);
    const auth = getApplicantAuth(req);
    const app = await applyAsRegisteredApplicant({
      jobId,
      applicantId: auth.applicantId,
    });
    const status = await getApplicationStatus(app.id);
    if (!status) throw new Error("Failed to read back created application");
    res.status(201).json(status);
  } catch (err) {
    next(err);
  }
});

/** Applicant — list only MY current applications with status. */
applicationsRouter.get("/applications/me", requireApplicant, async (req, res, next) => {
  try {
    const auth = getApplicantAuth(req);
    const apps = await getMyApplications(auth.applicantId);
    res.json(apps);
  } catch (err) {
    next(err);
  }
});

applicationsRouter.get(
  "/applications/:applicationId",
  async (req, res, next) => {
    try {
      const { applicationId: id } = ApplicationIdParams.parse(req.params);
      const status = await getApplicationStatus(id);
      if (!status) throw new NotFoundError("Application not found");
      res.json(status);
    } catch (err) {
      next(err);
    }
  },
);

applicationsRouter.post(
  "/applications/:applicationId/acknowledge",
  requireApplicant,
  async (req, res, next) => {
    try {
    const { applicationId: id } = ApplicationIdParams.parse(req.params);
    const auth = getApplicantAuth(req);
    const owns = await applicationBelongsToApplicant(id, auth.applicantId);
      if (!owns) throw new ForbiddenError("Not your application");
      await acknowledgeApplication(id);
      const status = await getApplicationStatus(id);
      if (!status) throw new NotFoundError("Application not found after ack");
      res.json(status);
    } catch (err) {
      next(err);
    }
  },
);

applicationsRouter.post(
  "/applications/:applicationId/exit",
  requireApplicant,
  async (req, res, next) => {
    try {
    const { applicationId: id } = ApplicationIdParams.parse(req.params);
    const auth = getApplicantAuth(req);
    const owns = await applicationBelongsToApplicant(id, auth.applicantId);
      if (!owns) throw new ForbiddenError("Not your application");
      await exitApplication(id);
      const status = await getApplicationStatus(id);
      if (!status) throw new NotFoundError("Application not found after exit");
      res.json(status);
    } catch (err) {
      next(err);
    }
  },
);

export default applicationsRouter;
