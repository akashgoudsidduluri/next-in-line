import { Router, type IRouter } from "express";
import healthRouter from "./health";
import jobsRouter from "./jobs";
import applicationsRouter from "./applications";
import companyAuthRouter from "./companyAuth";
import applicantAuthRouter from "./applicantAuth";
import { errorHandler } from "../middlewares/errorHandler";

const router: IRouter = Router();

router.use(healthRouter);
router.use(companyAuthRouter);
router.use(applicantAuthRouter);
router.use(jobsRouter);
router.use(applicationsRouter);

router.use(errorHandler);

export default router;
