import pino from "pino";
import { requestContext } from "../middlewares/correlation";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Elite Structured Logger.
 * Uses a mixin to automatically inject the Correlation ID from AsyncLocalStorage 
 * into every log line without manual effort.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  // Redact sensitive data from logs for security compliance
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
    "password",
    "password_hash",
    "token",
  ],
  // Inject request-scoped context into every log line
  mixin() {
    const context = requestContext.getStore();
    return context ? { correlationId: context.correlationId } : {};
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
