import express, { type Express } from "express";
import { securityMiddleware } from "./middlewares/security";
import { loggingMiddleware } from "./middlewares/logging";
import { correlationMiddleware } from "./middlewares/correlation";
import { metricsMiddleware } from "./middlewares/metrics";
import router from "./routes";

const app: Express = express();

/* ──────────────────────────  MIDDLEWARE STACK  ────────────────────────── */

// 1. Traceability & Metrics
app.use(correlationMiddleware);
app.use(metricsMiddleware);

// 2. Security by Default (Headers, CORS, Rate Limiting)
app.use("/api", securityMiddleware());

// 3. Observability (Structured Logging)
app.use(loggingMiddleware());

// 4. Body Parsing
app.use(express.json());

/* ──────────────────────────────  ROUTES  ─────────────────────────────── */

// API Versioning: v1
app.use("/api/v1", router);

export default app;
