import express, { type Express } from "express";
import { securityMiddleware } from "./middlewares/security";
import { loggingMiddleware } from "./middlewares/logging";
import router from "./routes";

const app: Express = express();

// Secure by Default: Centralized Security (Headers, CORS, Rate Limiting)
app.use("/api", securityMiddleware());

app.use(loggingMiddleware());
app.use(express.json());

app.use("/api", router);

export default app;
