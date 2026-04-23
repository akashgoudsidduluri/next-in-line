import { Router, type IRouter } from "express";
import { ApplyToJobBody } from "@workspace/api-zod";
import {
  applyToJob,
  acknowledgeApplication,
  exitApplication,
  getApplicationStatus,
} from "../services/queueEngine";
import { toApplicationStatusDto } from "../services/dto";

const router: IRouter = Router();

router.post("/jobs/:jobId/apply", async (req, res, next) => {
  try {
    const jobId = req.params["jobId"]!;
    const body = ApplyToJobBody.parse(req.body);
    const app = await applyToJob({
      jobId,
      name: body.name,
      email: body.email,
    });
    const status = await getApplicationStatus(app.id);
    if (!status) throw new Error("Failed to read back created application");
    res.status(201).json(toApplicationStatusDto(status.app, status.applicant));
  } catch (err) {
    next(err);
  }
});

router.get("/applications/:applicationId", async (req, res, next) => {
  try {
    const id = req.params["applicationId"]!;
    const status = await getApplicationStatus(id);
    if (!status) {
      res.status(404).json({ error: "Application not found" });
      return;
    }
    res.json(toApplicationStatusDto(status.app, status.applicant));
  } catch (err) {
    next(err);
  }
});

router.post(
  "/applications/:applicationId/acknowledge",
  async (req, res, next) => {
    try {
      const id = req.params["applicationId"]!;
      await acknowledgeApplication(id);
      const status = await getApplicationStatus(id);
      if (!status) throw new Error("Application disappeared after ack");
      res.json(toApplicationStatusDto(status.app, status.applicant));
    } catch (err) {
      next(err);
    }
  },
);

router.post("/applications/:applicationId/exit", async (req, res, next) => {
  try {
    const id = req.params["applicationId"]!;
    await exitApplication(id);
    const status = await getApplicationStatus(id);
    if (!status) throw new Error("Application disappeared after exit");
    res.json(toApplicationStatusDto(status.app, status.applicant));
  } catch (err) {
    next(err);
  }
});

export default router;
