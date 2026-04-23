import { describe, it, expect } from "vitest";
import { canTransition, assertTransition, STATES } from "./stateMachine";
import { InvalidTransitionError } from "../lib/errors";

describe("stateMachine", () => {
  const VALID: ReadonlyArray<[string, string]> = [
    ["WAITLISTED", "ACTIVE"],
    ["WAITLISTED", "EXITED"],
    ["ACTIVE", "WAITLISTED"], // decay path
    ["ACTIVE", "EXITED"],
  ];

  it("allows every valid transition", () => {
    for (const [from, to] of VALID) {
      expect(canTransition(from as any, to as any)).toBe(true);
      expect(() => assertTransition(from as any, to as any)).not.toThrow();
    }
  });

  it("rejects every invalid transition (including self-loops and exit terminality)", () => {
    const invalid: Array<[string, string]> = [];
    for (const f of STATES) {
      for (const t of STATES) {
        if (!VALID.some(([x, y]) => x === f && y === t)) invalid.push([f, t]);
      }
    }
    expect(invalid.length).toBeGreaterThan(0);
    for (const [from, to] of invalid) {
      expect(canTransition(from as any, to as any)).toBe(false);
      expect(() => assertTransition(from as any, to as any)).toThrow(
        InvalidTransitionError,
      );
    }
  });

  it("EXITED is terminal", () => {
    for (const t of STATES) {
      expect(canTransition("EXITED", t)).toBe(false);
    }
  });
});
