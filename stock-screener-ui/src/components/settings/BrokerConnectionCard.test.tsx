// @vitest-environment happy-dom
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BrokerConnectionCard, formatExpiresIn, getStatusBadge } from "./BrokerConnectionCard";
import type { BrokerStatus } from "../../api/brokers";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";
import { renderWithMantine } from "../../test-utils/renderWithMantine";

beforeEach(() => setupBrowserMocks());
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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

  describe("getStatusBadge", () => {
    test("returns Unknown badge for null status", () => {
      const badge = getStatusBadge(null);
      renderWithMantine(badge);
      expect(screen.getByText("Unknown")).toBeInTheDocument();
    });

    test("returns Disconnected badge when not connected", () => {
      const badge = getStatusBadge({ connected: false, broker: "upstox", expires_in_hours: null, expires_at: null });
      renderWithMantine(badge);
      expect(screen.getByText("Disconnected")).toBeInTheDocument();
    });

    test("returns Connected badge when connected and not expired", () => {
      const badge = getStatusBadge({ connected: true, broker: "upstox", expires_in_hours: 24, expires_at: new Date().toISOString() });
      renderWithMantine(badge);
      expect(screen.getByText("Connected")).toBeInTheDocument();
    });

    test("returns Expired badge when connected but expires_in_hours is negative", () => {
      const badge = getStatusBadge({ connected: true, broker: "upstox", expires_in_hours: -1, expires_at: new Date().toISOString() });
      renderWithMantine(badge);
      expect(screen.getByText("Expired")).toBeInTheDocument();
    });
  });
});

describe("BrokerConnectionCard component", () => {
  const baseProps = {
    status: null as BrokerStatus | null,
    loading: false,
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onRefresh: vi.fn(),
  };

  test("renders card with Upstox Connection title", () => {
    renderWithMantine(<BrokerConnectionCard {...baseProps} />);
    expect(screen.getByText("Upstox Connection")).toBeInTheDocument();
  });

  test("shows connect button when disconnected", () => {
    renderWithMantine(
      <BrokerConnectionCard
        {...baseProps}
        status={{ connected: false, broker: "upstox", expires_in_hours: null, expires_at: null }}
      />,
    );
    expect(screen.getByTestId("connect-upstox-btn")).toBeInTheDocument();
  });

  test("shows disconnect button when connected", () => {
    renderWithMantine(
      <BrokerConnectionCard
        {...baseProps}
        status={{ connected: true, broker: "upstox", expires_in_hours: 24, expires_at: new Date().toISOString() }}
      />,
    );
    expect(screen.getByTestId("disconnect-upstox-btn")).toBeInTheDocument();
  });

  test("shows expires text when connected with expires_in_hours", () => {
    renderWithMantine(
      <BrokerConnectionCard
        {...baseProps}
        status={{ connected: true, broker: "upstox", expires_in_hours: 12.5, expires_at: new Date().toISOString() }}
      />,
    );
    expect(screen.getByTestId("broker-expires-text")).toBeInTheDocument();
    expect(screen.getByText("Expires in 12h 30m")).toBeInTheDocument();
  });

  test("shows refresh button", () => {
    renderWithMantine(<BrokerConnectionCard {...baseProps} />);
    expect(screen.getByTestId("refresh-broker-status-btn")).toBeInTheDocument();
  });

  test("renders helper text when disconnected", () => {
    renderWithMantine(
      <BrokerConnectionCard
        {...baseProps}
        status={{ connected: false, broker: "upstox", expires_in_hours: null, expires_at: null }}
      />,
    );
    expect(screen.getByText("Connect your Upstox account to enable live trading")).toBeInTheDocument();
  });

  test("shows data-loading attribute on buttons when loading", () => {
    renderWithMantine(
      <BrokerConnectionCard
        {...baseProps}
        loading={true}
        status={{ connected: true, broker: "upstox", expires_in_hours: 24, expires_at: new Date().toISOString() }}
      />,
    );
    expect(screen.getByTestId("disconnect-upstox-btn")).toHaveAttribute("data-loading");
  });
});
