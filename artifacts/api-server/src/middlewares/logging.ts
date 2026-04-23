import { type RequestHandler } from "express";
import pinoHttp from "pino-http";
import { logger } from "../lib/logger";

/**
 * Request logging middleware. Abstracts pino-http configuration for cleaner
 * app.ts and consistent logging behavior.
 */
export function loggingMiddleware(): RequestHandler {
  return pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }) as unknown as RequestHandler;
}
