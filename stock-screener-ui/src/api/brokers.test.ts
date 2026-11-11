import { describe, it, expect } from "vitest";
import { getBrokerStatus, connectUpstox, disconnectUpstox } from "./brokers";

// NOTE: BrokerStatus is a TypeScript interface (erased at runtime), so the
// type-shape tests that constructed a literal and re-asserted its own props
// were removed as tautological. The three functions below are thin API
// wrappers; their request/response behaviour is covered by state-layer tests
// that call them through mocked apiFetch/apiGet. A single smoke test is kept
// here solely so this file remains a valid vitest suite (guards the export
// surface against accidental removal).
describe("brokers module exports", () => {
  it("exposes getBrokerStatus, connectUpstox and disconnectUpstox as functions", () => {
    expect(typeof getBrokerStatus).toBe("function");
    expect(typeof connectUpstox).toBe("function");
    expect(typeof disconnectUpstox).toBe("function");
  });
});
