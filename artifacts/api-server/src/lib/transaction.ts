import { db } from "@workspace/db";
import { logger } from "./logger";
import { withRetry } from "./resilience";

/**
 * Higher-Order Transaction Wrapper with Resilience & Elite Observability.
 * 
 * Contract:
 * - Centralizes Drizzle transaction management.
 * - Implements retries for transient database failures.
 * - Provides consistent logging for transaction lifecycle, linked to Correlation ID.
 * - Measures and logs execution duration for performance monitoring.
 */
export async function withTransaction<T>(
  callback: (tx: any) => Promise<T>,
  name: string = "anonymous-transaction",
  existingTx?: any
): Promise<T> {
  // If we're already inside a transaction, reuse it instead of starting a new one.
  if (existingTx) {
    logger.debug({ transactionName: name, nested: true }, "Reusing existing transaction");
    return callback(existingTx);
  }

  return withRetry(async () => {
    const start = Date.now();
    logger.debug({ transactionName: name }, "Transaction starting");
    
    try {
      return await db.transaction(async (tx) => {
        const result = await callback(tx);
        const duration = Date.now() - start;
        logger.info({ transactionName: name, duration }, "Transaction committed successfully");
        return result;
      });
    } catch (err) {
      const duration = Date.now() - start;
      logger.error(
        { err, transactionName: name, duration }, 
        "Transaction failed and rolled back"
      );
      throw err;
    }
  }, { 
    maxRetries: 2
  });
}
