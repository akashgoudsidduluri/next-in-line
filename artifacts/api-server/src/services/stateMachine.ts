/**
 * Pure state machine — the source of truth for which transitions are legal.
 * Used by the queue engine before any DB write.
 *
 * Public-facing state names (per the API contract) are:
 *   WAITLISTED · ACTIVE · EXITED
 *
 * For audit/replay we additionally distinguish whether an ACTIVE applicant
 * has acknowledged. The replay engine surfaces this as the synthetic state
 * `PENDING_ACKNOWLEDGMENT` (ACTIVE with no `acknowledgedAt`).
 */

import { InvalidTransitionError } from "../lib/errors";

export const STATES = ["WAITLISTED", "ACTIVE", "EXITED"] as const;
export type State = (typeof STATES)[number];

/** Legal `from -> to` transitions. */
const ALLOWED: Record<State, ReadonlyArray<State>> = {
  WAITLISTED: ["ACTIVE", "EXITED"],
  ACTIVE: ["WAITLISTED", "EXITED"], // ACTIVE -> WAITLISTED only via decay
  EXITED: [], // terminal
};

export function canTransition(from: State, to: State): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function assertTransition(from: State, to: State): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}
