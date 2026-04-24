import helmet from "helmet";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { config } from "../lib/config";
import { Router } from "express";

/**
 * Centralized Security Middleware
 * 
 * Contract:
 * - Implements 'Security by Default' by applying Helmet, CORS, and Rate-Limiting.
 * - This single entry point ensures consistent security policies across the API.
 */
export function securityMiddleware(): Router {
  const router = Router();

  // 1. Hardened Security Headers (Helmet)
  router.use(helmet());

  // 2. Governed CORS Policy
  router.use(
    cors({
      origin: config.allowedOrigins.length === 1 && config.allowedOrigins[0] === "*" ? "*" : config.allowedOrigins,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );

  // 3. Rate Limiting to prevent brute-force and DoS
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 100, // Limit each IP to 100 requests per window
    message: { 
      code: "TOO_MANY_REQUESTS",
      error: "Too many requests, please try again later." 
    },
  });

  // Apply limiter to all routes under this middleware
  router.use(limiter);

  return router;
}
