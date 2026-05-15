import { describe, expect, test } from "vitest";
import type { BrokerStatus } from "./brokers";
import { getBrokerStatus, connectUpstox, disconnectUpstox } from "./brokers";

describe("Brokers API Types", () => {
  test("BrokerStatus interface has correct shape", () => {
    const status: BrokerStatus = {
      connected: true,
      broker: "upstox",
      expires_in_hours: 12.5,
      expires_at: "2024-01-02T00:00:00",
    };

    expect(status.connected).toBe(true);
    expect(status.broker).toBe("upstox");
    expect(typeof status.expires_in_hours).toBe("number");
    expect(typeof status.expires_at).toBe("string");
  });

  test("BrokerStatus with null values", () => {
    const status: BrokerStatus = {
      connected: false,
      broker: "upstox",
      expires_in_hours: null,
      expires_at: null,
    };

    expect(status.connected).toBe(false);
    expect(status.expires_in_hours).toBeNull();
    expect(status.expires_at).toBeNull();
  });
});

describe("Brokers API exports", () => {
  test("getBrokerStatus is exported as a function", () => {
    expect(typeof getBrokerStatus).toBe("function");
  });

  test("connectUpstox is exported as a function", () => {
    expect(typeof connectUpstox).toBe("function");
  });

  test("disconnectUpstox is exported as a function", () => {
    expect(typeof disconnectUpstox).toBe("function");
  });
});
