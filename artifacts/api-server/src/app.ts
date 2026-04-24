import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { config } from "./lib/config";
import { loggingMiddleware } from "./middlewares/logging";
import router from "./routes";

const app: Express = express();

// Secure by Default: Headers, CORS, and Rate Limiting
app.use(helmet());
app.use(
  cors({
    origin: config.allowedOrigins.length === 1 && config.allowedOrigins[0] === "*" ? "*" : config.allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100, // Limit each IP to 100 requests per window
  message: { error: "Too many requests, please try again later." },
});
app.use("/api", limiter);

app.use(loggingMiddleware());
app.use(express.json());

app.use("/api", router);

export default app;
