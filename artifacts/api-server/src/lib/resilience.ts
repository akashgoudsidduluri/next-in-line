import { logger } from "./logger";

/**
 * Resilient Retry Utility
 * 
 * Contract:
 * - Implements exponential backoff to handle transient failures.
 * - Max retries and initial delay are configurable.
 * - Logs each retry attempt with context.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: { maxRetries?: number; initialDelayMs?: number } = {}
): Promise<T> {
  const { maxRetries = 3, initialDelayMs = 500 } = options;
  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries) break;

      const delay = initialDelayMs * Math.pow(2, attempt - 1);
      logger.warn({ attempt, delay, err }, "Transient failure detected; retrying...");
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
