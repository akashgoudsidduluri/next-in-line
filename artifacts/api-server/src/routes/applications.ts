import { Router, type IRouter } from "express";
import { JobIdParams, ApplicationIdParams } from "@workspace/api-zod";
import {
  acknowledgeApplication,
  exitApplication,
  getApplicationStatus,
} from "../services/queueEngine";
import {
  applyAsRegisteredApplicant,
  applicationBelongsToApplicant,
} from "../services/queueEngineExt";
import { toApplicationStatusDto } from "../services/dto";
import { requireApplicant, getApplicantAuth } from "../auth/middleware";
import { ForbiddenError, NotFoundError } from "../lib/errors";

const router: IRouter = Router();

router.post("/jobs/:jobId/apply", requireApplicant, async (req, res, next) => {
  try {
    const { jobId } = JobIdParams.parse(req.params);
    const auth = getApplicantAuth(req);
    const app = await applyAsRegisteredApplicant({
      jobId,
      applicantId: auth.applicantId,
    });
    const status = await getApplicationStatus(app.id);
    if (!status) throw new Error("Failed to read back created application");
    res.status(201).json(toApplicationStatusDto(status.app, status.applicant));
  } catch (err) {
    next(err);
  }
});

router.get(
  "/applications/:applicationId",
  requireApplicant,
  async (req, res, next) => {
    try {
    const { applicationId: id } = ApplicationIdParams.parse(req.params);
    const auth = getApplicantAuth(req);
    const owns = await applicationBelongsToApplicant(id, auth.applicantId);
      if (!owns) throw new ForbiddenError("Not your application");
      const status = await getApplicationStatus(id);
      if (!status) throw new NotFoundError("Application not found");
      res.json(toApplicationStatusDto(status.app, status.applicant));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
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
      res.json(toApplicationStatusDto(status.app, status.applicant));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
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
      res.json(toApplicationStatusDto(status.app, status.applicant));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
