// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils/renderWithProviders";
import { VerdictBanner } from "./VerdictBanner";
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
  biggest_move: {
    strike: 25400.0,
    side: "CE",
    sentiment: "Short Buildup",
    label: "call writers opened (today)",
    cr: -50462.0,
  },
  rows: [],
};

describe("VerdictBanner", () => {
  test("renders bearish verdict with initiated and lean lines", () => {
    renderWithProviders(<VerdictBanner data={mockData} />);
    const banner = screen.getByTestId("positioning-verdict");
    expect(banner).toBeInTheDocument();
    expect(within(banner).getByTestId("positioning-verdict-word")).toHaveTextContent("▼ Bearish");
    expect(within(banner).getByTestId("positioning-verdict-initiated")).toHaveTextContent(
      "Today since open -87,494 Cr",
    );
    expect(within(banner).getByTestId("positioning-verdict-lean")).toHaveTextContent(
      /78\.5% of today's initiated delta since the open leans bearish/,
    );
  });

  test("renders biggest move line when present", () => {
    renderWithProviders(<VerdictBanner data={mockData} />);
    const banner = screen.getByTestId("positioning-verdict");
    expect(within(banner).getByTestId("positioning-verdict-biggest")).toHaveTextContent(
      "Biggest move: call writers opened (today) · -50,462 Cr",
    );
  });

  test("omits biggest move line when null", () => {
    renderWithProviders(<VerdictBanner data={{ ...mockData, biggest_move: null }} />);
    const banner = screen.getByTestId("positioning-verdict");
    expect(banner).toBeInTheDocument();
    expect(
      within(banner).queryByTestId("positioning-verdict-biggest"),
    ).not.toBeInTheDocument();
  });

  test("renders bullish verdict", () => {
    renderWithProviders(
      <VerdictBanner data={{ ...mockData, verdict: "bullish", initiated_cr: 45210 }} />,
    );
    expect(screen.getByTestId("positioning-verdict-word")).toHaveTextContent("▲ Bullish");
    expect(screen.getByTestId("positioning-verdict-initiated")).toHaveTextContent(
      "Today since open 45,210 Cr",
    );
  });

  test("renders neutral verdict with square icon", () => {
    renderWithProviders(
      <VerdictBanner data={{ ...mockData, verdict: "neutral", initiated_cr: 0 }} />,
    );
    expect(screen.getByTestId("positioning-verdict-word")).toHaveTextContent("■ Neutral");
  });

  test("renders disclaimer", () => {
    renderWithProviders(<VerdictBanner data={mockData} />);
    expect(
      within(screen.getByTestId("positioning-verdict")).getByText(
        "A read of OI and premium changes, not advice.",
      ),
    ).toBeInTheDocument();
  });

  test("renders null initiated Cr as em dash", () => {
    render(<VerdictBanner data={{ ...mockData, initiated_cr: null }} />);
    expect(screen.getByTestId("positioning-verdict-initiated")).toHaveTextContent(
      "Today since open —",
    );
  });
});
