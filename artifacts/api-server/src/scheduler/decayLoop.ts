/**
 * Decay loop — internal poller (no external scheduling libs).
 *
 * Polls every TICK_MS for ACTIVE applications whose ack_deadline has elapsed
 * and decays each one in its own transaction. Each decay also cascade-promotes
 * the next waitlisted applicant. The loop is a simple setTimeout chain so
 * ticks never overlap; if a tick takes longer than TICK_MS it just runs the
 * next tick immediately on completion.
 */

import { logger } from "../lib/logger";
import {
  decayActiveApplication,
  findExpiredActiveApplicationIds,
} from "../services/queueEngine";

const TICK_MS = 1000;

let running = false;
let stopped = false;

async function tick() {
  if (stopped) return;
  try {
    const ids = await findExpiredActiveApplicationIds();
    for (const id of ids) {
      try {
        const decayed = await decayActiveApplication(id);
        if (decayed) {
          logger.info({ applicationId: id }, "Application decayed");
        }
      } catch (err) {
        logger.error({ err, applicationId: id }, "Decay failed");
      }
    }
  } catch (err) {
    logger.error({ err }, "Decay loop tick failed");
  } finally {
    if (!stopped) setTimeout(tick, TICK_MS);
  }
}

export function startDecayLoop() {
  if (running) return;
  running = true;
  stopped = false;
  logger.info({ tickMs: TICK_MS }, "Decay scheduler started");
  setTimeout(tick, TICK_MS);
}

export function stopDecayLoop() {
  stopped = true;
}
