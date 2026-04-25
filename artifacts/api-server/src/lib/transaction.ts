import { db } from "@workspace/db";
import { logger } from "./logger";
import { withRetry } from "./resilience";

/**
 * Higher-Order Transaction Wrapper with Resilience
 * 
 * Contract:
 * - Centralizes Drizzle transaction management.
 * - Implements retries for transient database failures.
 * - Provides consistent logging for transaction lifecycle.
 */
export async function withTransaction<T>(
  callback: (tx: any) => Promise<T>
): Promise<T> {
  return withRetry(async () => {
    const start = Date.now();
    try {
      return await db.transaction(async (tx) => {
        const result = await callback(tx);
        const duration = Date.now() - start;
        logger.debug({ duration }, "Transaction committed successfully");
        return result;
      });
    } catch (err) {
      const duration = Date.now() - start;
      logger.error({ err, duration }, "Transaction failed and rolled back");
      throw err;
    }
  }, { maxRetries: 2 });
}
