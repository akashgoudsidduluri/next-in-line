import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import healthRouter from "./health";
import jobsRouter from "./jobs";
import applicationsRouter from "./applications";

const router: IRouter = Router();

router.use(healthRouter);
router.use(jobsRouter);
router.use(applicationsRouter);

// Centralised error handler — last middleware in the stack.
router.use(
  (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : "Internal server error";
    req.log?.error({ err }, "Request failed");
    const status =
      message.includes("not found") || message.startsWith("Job not found")
        ? 404
        : message.includes("Cannot acknowledge") ||
          message.startsWith("Failed")
        ? 409
        : 400;
    res.status(status).json({ error: message });
  },
);

export default router;
