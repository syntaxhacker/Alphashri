// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, afterEach } from "vitest";
import { screen, within, cleanup } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils/renderWithProviders";
import { ReadingTable } from "./ReadingTable";
import type { PositioningData } from "@/utils/positioning";

afterEach(() => {
  cleanup();
});

const mockData: PositioningData = {
  status: "ok",
  underlying: "NIFTY",
  expiry: "2026-10-14",
  spot: 25400.5,
  lot_size: 25,
  timestamp: "2026-10-12T14:30:00+05:30",
  baseline: "prev_close_oi",
  baseline_note: "note",
  verdict: "bearish",
  initiated_cr: -87494.0,
  lean_pct: 78.5,
  state: { calls_cr: 1200000.0, puts_cr: -900000.0, note: "puts outweigh calls" },
  flow: { calls_cr: -50000.0, puts_cr: -37000.0, note: "calls outweigh puts" },
  initiated: { bearish_cr: -90000.0, bullish_cr: 2506.0, note: "Short build-up" },
  split: { bearish_cr: -90000.0, bearish_pct: 97.3, bullish_cr: 2506.0, bullish_pct: 2.7 },
  read: { pct: 92.4, readable_shares: 123456, total_shares: 133600 },
  biggest_move: null,
  rows: [],
};

describe("ReadingTable", () => {
  test("renders all five reading rows", () => {
    renderWithProviders(<ReadingTable data={mockData} />);
    for (const id of ["state", "flow", "initiated", "split", "read"]) {
      expect(screen.getByTestId(`positioning-reading-${id}`)).toBeInTheDocument();
    }
  });

  test("state row shows net value and note", () => {
    renderWithProviders(<ReadingTable data={mockData} />);
    const row = screen.getByTestId("positioning-reading-state");
    expect(within(row).getByText("3,00,000 Cr")).toBeInTheDocument();
    expect(within(row).getByText("puts outweigh calls")).toBeInTheDocument();
  });

  test("flow and initiated rows show net values", () => {
    renderWithProviders(<ReadingTable data={mockData} />);
    expect(
      within(screen.getByTestId("positioning-reading-flow")).getByText("-87,000 Cr"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("positioning-reading-initiated")).getByText("-87,494 Cr"),
    ).toBeInTheDocument();
  });

  test("split row shows stacked bar total and leg breakdown", () => {
    renderWithProviders(<ReadingTable data={mockData} />);
    const row = screen.getByTestId("positioning-reading-split");
    expect(within(row).getByText("92,506 Cr · 100%")).toBeInTheDocument();
    expect(
      within(row).getByText("Bearish -90,000 Cr · Bullish 2,506 Cr"),
    ).toBeInTheDocument();
  });

  test("read row shows pct and share coverage", () => {
    renderWithProviders(<ReadingTable data={mockData} />);
    const row = screen.getByTestId("positioning-reading-read");
    expect(within(row).getByText("+92.4%")).toBeInTheDocument();
    expect(within(row).getByText("1.2L of 1.3L shares readable")).toBeInTheDocument();
  });

  test("null flow legs render em dash", () => {
    const data: PositioningData = {
      ...mockData,
      flow: { calls_cr: null, puts_cr: null, note: "no flow" },
    };
    renderWithProviders(<ReadingTable data={data} />);
    expect(
      within(screen.getByTestId("positioning-reading-flow")).getByText("—"),
    ).toBeInTheDocument();
  });
});
