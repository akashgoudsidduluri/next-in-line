import { logger } from "../lib/logger";
import { LeasedTaskRunner } from "../lib/scheduler";
import {
  decayActiveApplication,
  findExpiredActiveApplicationIds,
} from "../services/queueEngine";

const SCHEDULER_LOCK_ID = 888123;
const TICK_MS = 2000;

/**
 * The core decay task. Polled by the LeasedTaskRunner.
 */
async function processDecays() {
  const ids = await findExpiredActiveApplicationIds();
  if (ids.length > 0) {
    logger.info({ count: ids.length }, "Processing expired applications");
  }

  for (const id of ids) {
    try {
      const decayed = await decayActiveApplication(id);
      if (decayed) {
        logger.info({ applicationId: id }, "Application decayed");
      }
    } catch (err) {
      logger.error({ err, applicationId: id }, "Decay processing failed for application");
    }
  }
}

/**
 * DecayScheduler
 * 
 * Instance-based scheduler to avoid global state and improve testability.
 */
export class DecayScheduler {
  private runner: LeasedTaskRunner;

  constructor() {
    this.runner = new LeasedTaskRunner(
      {
        name: "DecayScheduler",
        lockId: SCHEDULER_LOCK_ID,
        intervalMs: TICK_MS,
      },
      processDecays
    );
  }

  public start() {
    this.runner.start();
  }

  public stop() {
    this.runner.stop();
  }
}
