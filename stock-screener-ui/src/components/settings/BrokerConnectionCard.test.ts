import { describe, expect, test } from "vitest";

function formatExpiresIn(hours: number | null): string {
  if (hours === null) return "";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  return `${m}m`;
}

function getStatusBadgeColor(connected: boolean, expires_in_hours: number | null): string {
  if (!connected) {
    if (expires_in_hours !== null && expires_in_hours < 0) {
      return "yellow";
    }
    return "red";
  }
  return "green";
}

function isConnected(
  status: { connected: boolean; expires_in_hours: number | null } | null,
): boolean {
  if (!status) return false;
  return status.connected && (status.expires_in_hours === null || status.expires_in_hours >= 0);
}

describe("BrokerConnectionCard helpers", () => {
  describe("formatExpiresIn", () => {
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

  describe("getStatusBadgeColor", () => {
    test("returns green when connected", () => {
      expect(getStatusBadgeColor(true, 12)).toBe("green");
      expect(getStatusBadgeColor(true, null)).toBe("green");
    });

    test("returns red when disconnected", () => {
      expect(getStatusBadgeColor(false, null)).toBe("red");
    });

    test("returns yellow when expired", () => {
      expect(getStatusBadgeColor(false, -1)).toBe("yellow");
      expect(getStatusBadgeColor(false, -0.5)).toBe("yellow");
    });
  });

  describe("isConnected", () => {
    test("returns true when connected with valid expiry", () => {
      expect(isConnected({ connected: true, expires_in_hours: 12 })).toBe(true);
    });

    test("returns true when connected with null expiry", () => {
      expect(isConnected({ connected: true, expires_in_hours: null })).toBe(true);
    });

    test("returns false when not connected", () => {
      expect(isConnected({ connected: false, expires_in_hours: null })).toBe(false);
    });

    test("returns false when expired", () => {
      expect(isConnected({ connected: true, expires_in_hours: -1 })).toBe(false);
    });

    test("returns false when status is null", () => {
      expect(isConnected(null)).toBe(false);
    });
  });
});
