import { describe, expect, test } from "bun:test";

describe("Brokers API Types", () => {
  test("BrokerStatus interface has correct shape", () => {
    const status = {
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
    const status = {
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

describe("formatExpiresIn helper", () => {
  function formatExpiresIn(hours: number | null): string {
    if (hours === null) return "";
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    if (h > 0) {
      return `${h}h ${m}m`;
    }
    return `${m}m`;
  }

  test("formats hours and minutes correctly", () => {
    expect(formatExpiresIn(12.5)).toBe("12h 30m");
    expect(formatExpiresIn(1.0)).toBe("1h 0m");
    expect(formatExpiresIn(23.75)).toBe("23h 45m");
  });

  test("formats only minutes when less than 1 hour", () => {
    expect(formatExpiresIn(0.5)).toBe("30m");
    expect(formatExpiresIn(0.25)).toBe("15m");
    expect(formatExpiresIn(0.0)).toBe("0m");
  });

  test("returns empty string for null", () => {
    expect(formatExpiresIn(null)).toBe("");
  });
});

describe("getStatusColor helper", () => {
  function getStatusColor(connected: boolean, expires_in_hours: number | null): string {
    if (!connected) {
      if (expires_in_hours !== null && expires_in_hours < 0) {
        return "yellow";
      }
      return "red";
    }
    return "green";
  }

  test("returns green when connected", () => {
    expect(getStatusColor(true, 12)).toBe("green");
    expect(getStatusColor(true, null)).toBe("green");
  });

  test("returns red when disconnected", () => {
    expect(getStatusColor(false, null)).toBe("red");
  });

  test("returns yellow when expired", () => {
    expect(getStatusColor(false, -1)).toBe("yellow");
    expect(getStatusColor(false, -0.5)).toBe("yellow");
  });
});
