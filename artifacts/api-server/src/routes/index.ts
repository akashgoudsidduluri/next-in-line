import { Router, type IRouter } from "express";
import { errorHandler } from "../middlewares/errorHandler";

/**
 * Elite Route Orchestrator.
 * 
 * Rationale:
 * Instead of tight coupling in the main app, we use a modular registration 
 * strategy. Each domain (jobs, applications, auth) is its own isolated 
 * unit that registers its paths onto the main router.
 */

const router: IRouter = Router();

/**
 * Modular Route Registration
 * Evolution: Instead of manual app.use() in app.ts, we encapsulate 
 * the versioned route tree here.
 */
async function registerDomainRoutes() {
  console.log("[Router] Initializing Elite Route Registry...");
  
  const { healthRouter } = await import("./health");
  const { companyAuthRouter } = await import("./companyAuth");
  const { applicantAuthRouter } = await import("./applicantAuth");
  const { jobsRouter } = await import("./jobs");
  const { applicationsRouter } = await import("./applications");

  router.use(healthRouter);
  console.log("[Router] Mounted /healthz");
  
  router.use(companyAuthRouter);
  console.log("[Router] Mounted /company/auth");
  
  router.use(applicantAuthRouter);
  console.log("[Router] Mounted /applicant/auth");
  
  router.use(jobsRouter);
  console.log("[Router] Mounted /jobs");
  
  router.use(applicationsRouter);
  console.log("[Router] Mounted /applications");

  router.use(errorHandler);
  console.log("[Router] Mounted Error Handler. Registry Certified.");
}

// Initialise the registry
registerDomainRoutes().catch((err) => {
  console.error("Failed to register routes", err);
});

export default router;
