// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalystToday } from "@/api/catalysts";
import { SessionPulseBar } from "./SessionPulseBar";

const store = vi.hoisted(() => ({
  data: null as unknown,
  loading: false,
  error: null as string | null,
  refresh: vi.fn(),
}));

vi.mock("@/state/catalystStore", () => ({
  useCatalystToday: () => ({
    data: () => store.data,
    loading: () => store.loading,
    error: () => store.error,
    sector: () => "auto",
    sectors: () => [],
    setSector: () => {},
    refresh: store.refresh,
  }),
}));

function snapshot(overrides: Partial<CatalystToday> = {}): CatalystToday {
  return {
    as_of: "2026-11-19T11:13:00+05:30",
    market: {
      nifty: { last: 25304.2, change_pct: 0.3 },
      sensex: { last: 82300, change_pct: 0.4 },
      vix: 16.31,
    },
    sector: {
      id: "auto",
      label: "NIFTY AUTO",
      change_pct: 3.75,
      relative_strength_pct: 3.45,
      breadth: { advancing: 12, declining: 3, total: 15 },
    },
    available_sectors: [
      { id: "auto", label: "NIFTY AUTO", count: 15 },
      { id: "it", label: "NIFTY IT", count: 10 },
    ],
    rows: [],
    counts: { high: 2, medium: 1, low: 0, total: 3 },
    warnings: [],
    ...overrides,
  };
}

const pulse = () => screen.getByTestId("home-pulse-bar");

beforeEach(() => {
  store.data = null;
  store.loading = false;
  store.error = null;
  store.refresh.mockClear();
});

afterEach(cleanup);

describe("SessionPulseBar", () => {
  it("(values) renders the snapshot clock, indices, auto pulse, breadth and counts", () => {
    store.data = snapshot();
    render(() => <SessionPulseBar />);

    expect(screen.getByTestId("pulse-clock")).toHaveTextContent("11:13 IST");
    expect(screen.getByTestId("pulse-nifty")).toHaveTextContent("25,304.20");
    expect(screen.getByTestId("pulse-nifty")).toHaveTextContent("+0.30%");
    expect(screen.getByTestId("pulse-sensex")).toHaveTextContent("82,300.00");
    expect(screen.getByTestId("pulse-sector")).toHaveTextContent("NIFTY AUTO");
    expect(screen.getByTestId("pulse-sector")).toHaveTextContent("+3.75%");
    expect(screen.getByTestId("pulse-sector")).toHaveTextContent("+3.45%");
    expect(screen.getByTestId("pulse-breadth")).toHaveTextContent("12 / 3 of 15");
    expect(screen.getByTestId("pulse-catalysts")).toHaveTextContent("2H 1M 0L");
    expect(screen.getByTestId("pulse-alerts")).toHaveTextContent("2 HIGH");
    expect(screen.getByTestId("pulse-refresh")).toHaveTextContent("LIVE");
  });

  it("(alerts) zero high-priority catalysts reads Quiet instead of a zero", () => {
    store.data = snapshot({ counts: { high: 0, medium: 1, low: 0, total: 1 } });
    render(() => <SessionPulseBar />);

    const alerts = screen.getByTestId("pulse-alerts");
    expect(alerts).toHaveTextContent("Quiet");
    expect(alerts).not.toHaveTextContent("0");
  });

  it("(null) absent readings are dashes, never zero-filled values", () => {
    store.data = snapshot({
      as_of: null,
      market: null,
      sector: null,
      counts: null,
    });
    render(() => <SessionPulseBar />);

    expect(screen.getByTestId("pulse-clock")).toHaveTextContent("—");
    expect(screen.getByTestId("pulse-nifty")).toHaveTextContent("—");
    expect(screen.getByTestId("pulse-breadth")).toHaveTextContent("—");
    expect(screen.getByTestId("pulse-sector")).toHaveTextContent("—");
    expect(screen.getByTestId("pulse-catalysts")).toHaveTextContent("—");
    expect(screen.getByTestId("pulse-alerts")).toHaveTextContent("—");
    expect(pulse()).not.toHaveTextContent("0.00");
  });

  it("(loading) the first load is explicit while prices stay blank", () => {
    store.loading = true;
    render(() => <SessionPulseBar />);

    expect(pulse()).toHaveTextContent("LOADING");
    expect(screen.getByTestId("pulse-nifty")).toHaveTextContent("—");
  });

  it("(error) a failed refresh keeps the last good readings and says so", () => {
    store.data = snapshot();
    store.error = "Feed unavailable";
    store.loading = true;
    render(() => <SessionPulseBar />);

    expect(screen.getByTestId("pulse-refresh")).toHaveTextContent("LAST GOOD");
    expect(screen.getByTestId("pulse-nifty")).toHaveTextContent("25,304.20");
  });

  it("(warnings) partial sources are surfaced, not hidden behind LIVE", () => {
    store.data = snapshot({ warnings: ["event_source_unavailable", "wire_timeout"] });
    render(() => <SessionPulseBar />);

    const refresh = screen.getByTestId("pulse-refresh");
    expect(refresh).toHaveTextContent("PARTIAL");
    expect(refresh.querySelector("[title]")?.getAttribute("title")).toContain(
      "event_source_unavailable",
    );
  });

  it("(aria) only alert and feed status changes are announced, not price ticks", () => {
    store.data = snapshot();
    render(() => <SessionPulseBar />);

    expect(screen.getByTestId("pulse-alerts")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByTestId("pulse-refresh")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByTestId("pulse-nifty")).not.toHaveAttribute("aria-live");
    expect(screen.getByTestId("pulse-sector")).not.toHaveAttribute("aria-live");
  });

  it("(format) a sub-centi negative move reads +0.00%, never -0.00%", () => {
    const base = snapshot();
    store.data = snapshot({
      market: { ...base.market!, nifty: { last: 25304.2, change_pct: -0.001 } },
      sector: { ...base.sector!, change_pct: -0.002, relative_strength_pct: -0.003 },
    });
    render(() => <SessionPulseBar />);

    expect(pulse()).not.toHaveTextContent("-0.00%");
    expect(screen.getByTestId("pulse-nifty")).toHaveTextContent("0.00%");
    expect(screen.getByTestId("pulse-sector")).toHaveTextContent("0.00%");
  });
});
