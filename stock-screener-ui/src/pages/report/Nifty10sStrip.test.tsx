// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { Nifty10sStrip } from "./Nifty10sStrip";
import type { OiPoint } from "./Nifty10sStrip";

afterEach(cleanup);

/** Absolute totals per side, as aggregated by the backend. */
function pt(
  t: string,
  ce: number,
  pe: number,
  cePrem: number | null = null,
  pePrem: number | null = null,
): OiPoint {
  return { t: `2026-10-26T${t}+05:30`, ce, pe, cePrem, pePrem };
}

const read = () => screen.getByTestId("nifty-10s-state");

describe("Nifty10sStrip", () => {
  test("put OI building with a RICHER put is put buying (bearish)", () => {
    render(
      <Nifty10sStrip
        points={[pt("09:53:00", 1_000_000, 1_000_000, 100, 100), pt("09:53:10", 1_050_000, 1_500_000, 101, 118)]}
      />,
    );
    expect(read()).toHaveTextContent("↓ BEARISH");
    expect(screen.getByTestId("nifty-10s-reason")).toHaveTextContent("puts bought");
    expect(screen.getByTestId("nifty-10s-strip")).toHaveAttribute("data-state", "bear");
  });

  test("put OI building with a CHEAPER put is put writing (bullish)", () => {
    render(
      <Nifty10sStrip
        points={[pt("09:53:00", 1_000_000, 1_000_000, 100, 100), pt("09:53:10", 1_050_000, 1_500_000, 101, 88)]}
      />,
    );
    expect(read()).toHaveTextContent("↑ BULLISH");
    expect(screen.getByTestId("nifty-10s-reason")).toHaveTextContent("puts sold");
    expect(screen.getByTestId("nifty-10s-strip")).toHaveAttribute("data-state", "bull");
  });

  test("call OI building with a RICHER call is call buying (bullish)", () => {
    render(
      <Nifty10sStrip
        points={[pt("09:53:00", 1_000_000, 1_000_000, 100, 100), pt("09:53:10", 1_500_000, 1_050_000, 118, 99)]}
      />,
    );
    expect(read()).toHaveTextContent("↑ BULLISH");
    expect(screen.getByTestId("nifty-10s-reason")).toHaveTextContent("calls bought");
    expect(screen.getByTestId("nifty-10s-strip")).toHaveAttribute("data-state", "bull");
  });

  test("call OI falling with a RICHER call is short covering (bullish)", () => {
    render(
      <Nifty10sStrip
        points={[pt("09:53:00", 2_000_000, 1_000_000, 100, 100), pt("09:53:10", 1_500_000, 1_050_000, 118, 99)]}
      />,
    );
    expect(read()).toHaveTextContent("↑ BULLISH");
    expect(screen.getByTestId("nifty-10s-reason")).toHaveTextContent("calls bought back");
    expect(screen.getByTestId("nifty-10s-strip")).toHaveAttribute("data-state", "bull");
  });

  test("call OI falling with a CHEAPER call is long liquidation (bearish)", () => {
    render(
      <Nifty10sStrip
        points={[pt("09:53:00", 2_000_000, 1_000_000, 100, 100), pt("09:53:10", 1_500_000, 1_050_000, 82, 99)]}
      />,
    );
    expect(read()).toHaveTextContent("↓ BEARISH");
    expect(screen.getByTestId("nifty-10s-reason")).toHaveTextContent("calls closed");
    expect(screen.getByTestId("nifty-10s-strip")).toHaveAttribute("data-state", "bear");
  });

  test("without a premium tape it falls back to OI direction", () => {
    render(<Nifty10sStrip points={[pt("09:53:00", 2_000_000, 1_000_000), pt("09:53:10", 1_500_000, 1_400_000)]} />);
    expect(read()).toHaveTextContent("↑ BULLISH");
    expect(screen.getByTestId("nifty-10s-reason")).toHaveTextContent("calls unwound");
    expect(screen.getByTestId("nifty-10s-ce")).toHaveTextContent("−500K");
    expect(screen.getByTestId("nifty-10s-pe")).toHaveTextContent("+400K");
  });

  test("diffs a 10 s window even when the last two samples are identical", () => {
    // Poller bursts to 3 s cadence: the last two samples plateau, but the
    // 1 m window still carries the move that matters.
    render(
      <Nifty10sStrip
        points={[
          pt("09:53:00", 2_000_000, 1_000_000),
          pt("09:53:10", 1_500_000, 1_400_000),
          pt("09:53:13", 1_500_000, 1_400_000),
        ]}
      />,
    );
    expect(screen.getByTestId("nifty-10s-strip")).toHaveAttribute("data-state", "bull");
    expect(screen.getByTestId("nifty-10s-ce")).toHaveTextContent("−500K");
    expect(screen.getByTestId("nifty-10s-pe")).toHaveTextContent("+400K");
  });

  test("flags a 10 s burst when a single window moves a million lots", () => {
    render(<Nifty10sStrip points={[pt("09:53:00", 3_000_000, 1_000_000), pt("09:53:10", 1_500_000, 1_400_000)]} />);
    expect(screen.getByTestId("nifty-10s-burst")).toHaveTextContent("BURST");
  });

  test("sub-100K drift stays balanced", () => {
    render(<Nifty10sStrip points={[pt("09:53:00", 1_000_000, 1_000_000), pt("09:53:10", 1_050_000, 1_040_000)]} />);
    expect(screen.getByTestId("nifty-10s-strip")).toHaveAttribute("data-state", "balanced");
    expect(read()).toHaveTextContent("FLAT");
  });

  test("renders a bias ribbon with persistence counts", () => {
    render(
      <Nifty10sStrip
        points={[pt("09:53:00", 1_000_000, 1_000_000), pt("09:53:10", 1_300_000, 1_400_000)]}
      />,
    );
    expect(screen.getByTestId("nifty-10s-ribbon").querySelectorAll("rect")).toHaveLength(2);
    expect(screen.getByTestId("nifty-10s-counts")).toHaveTextContent("1↑");
  });

  test("the ribbon keeps a flip visible instead of one flapping word", () => {
    render(
      <Nifty10sStrip
        points={[
          pt("09:53:00", 1_000_000, 1_000_000),
          pt("09:53:10", 1_300_000, 1_000_000), // calls added → bearish
          pt("09:54:20", 1_000_000, 1_300_000), // puts added → bullish
        ]}
      />,
    );
    expect(screen.getByTestId("nifty-10s-counts")).toHaveTextContent("1↑");
    expect(screen.getByTestId("nifty-10s-counts")).toHaveTextContent("1↓");
  });

  test("renders nothing without two points", () => {
    const { container } = render(<Nifty10sStrip points={[pt("09:53:00", 1, 1)]} />);
    expect(container.firstChild).toBeNull();
  });

  describe("noise prop (symbol-aware flow filtering)", () => {
    test("noise=100k filters a 60k delta (SENSEX ~100k default)", () => {
      // 60k CE OI change with 100k noise floor → should be FLAT
      render(
        <Nifty10sStrip
          noise={100_000}
          points={[pt("09:53:00", 1_000_000, 1_000_000), pt("09:53:10", 1_060_000, 1_000_000)]}
        />,
      );
      expect(screen.getByTestId("nifty-10s-strip")).toHaveAttribute("data-state", "balanced");
      expect(read()).toHaveTextContent("FLAT");
    });

    test("noise=50k passes a 60k delta (RELIANCE ~50k default)", () => {
      // 60k CE OI change with 50k noise floor → should be BULLISH (calls unwound)
      render(
        <Nifty10sStrip
          noise={50_000}
          points={[pt("09:53:00", 2_000_000, 1_000_000), pt("09:53:10", 1_940_000, 1_000_000)]}
        />,
      );
      expect(screen.getByTestId("nifty-10s-strip")).toHaveAttribute("data-state", "bull");
      expect(read()).toHaveTextContent("↑ BULLISH");
      expect(screen.getByTestId("nifty-10s-reason")).toHaveTextContent("calls unwound");
    });

    test("default noise (100k) preserves NIFTY behavior", () => {
      // 60k CE OI change with default 100k noise → FLAT (NIFTY behavior)
      render(
        <Nifty10sStrip
          points={[pt("09:53:00", 1_000_000, 1_000_000), pt("09:53:10", 1_060_000, 1_000_000)]}
        />,
      );
      expect(screen.getByTestId("nifty-10s-strip")).toHaveAttribute("data-state", "balanced");
      expect(read()).toHaveTextContent("FLAT");
    });
  });
});
