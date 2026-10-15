// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";
import {
  NiftyUnusualVolume,
  buildUnusualRows,
  formatUnusualCompact,
  formatUnusualFocus,
  formatUnusualShare,
  getNiftyUnusualColumns,
  getUnusualSentimentTone,
  isItmLeg,
  UNUSUAL_SENTIMENT_NAMES,
} from "./NiftyUnusualVolume";
import type { NiftyStrike } from "@/types/niftyReport";

vi.mock("@/api/reportNifty", () => ({
  fetchLiveNifty: vi.fn(),
  fetchNiftyByDate: vi.fn(),
  fetchNiftyExpiries: vi.fn().mockResolvedValue([]),
  fetchNiftyTape: vi.fn(),
  fetchNiftyBursts: vi.fn().mockResolvedValue([]),
  snapshotNifty: vi.fn(),
}));

vi.mock("@/components/chart/TradingViewChart", () => ({
  TradingViewChart: () => <div data-testid="tradingview-chart" />,
}));

vi.mock("echarts-for-react", () => ({
  default: () => <div data-testid="nifty-depth-echarts" />,
}));

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: TestWrapper });
}

function side(volume: number, oi: number, sentiment = "LB") {
  return {
    ltp: 10, close: 9, oi, prevOi: oi, oiChange: 0, priceChange: 0,
    sentiment, volume,
  };
}

function strikeAt(
  strike: number,
  ce = side(1000, 1000),
  pe = side(1000, 1000, "SB"),
): NiftyStrike {
  return { strike, ce, pe };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("buildUnusualRows", () => {
  test("splits one strike into a CE row and a PE row", () => {
    const rows = buildUnusualRows([strikeAt(25700)]);
    expect(rows).toHaveLength(2);
    expect(rows.map((x) => x.leg).sort()).toEqual(["CE", "PE"]);
    expect(rows.map((x) => x.key).sort()).toEqual(["25700-CE", "25700-PE"]);
  });

  test("ranks the top-30-by-volume pool by Vol÷OI desc, not volume desc", () => {
    const rows = buildUnusualRows([
      strikeAt(25000, side(100_000, 10_000, "LB"), side(50_000, 50_000, "SB")),
      strikeAt(25100, side(90_000, 1_000, "LB"), side(1_000, 1_000, "SB")),
    ]);
    // pool by volume: 100k, 90k, 50k, 1k — rank by ratio: 90, 10, 1, 1
    expect(rows.map((x) => x.key)).toEqual([
      "25100-CE",
      "25000-CE",
      "25000-PE",
      "25100-PE",
    ]);
    expect(rows.map((x) => x.rank)).toEqual([1, 2, 3, 4]);
    expect(rows[0].volOi).toBeCloseTo(90, 10);
    expect(rows[1].volOi).toBeCloseTo(10, 10);
  });

  test("drops low-volume legs beyond the top-30 pool even with high ratios", () => {
    const strikes = Array.from({ length: 20 }, (_, i) =>
      strikeAt(25000 + i * 100, side(10_000 + i * 1_000, 5_000, "LB"), side(9_000, 5_000, "SB")),
    );
    // tiny far-OTM leg with an extreme ratio must not displace real volume
    strikes.push(strikeAt(29000, side(5, 1, "LB"), side(5, 1, "SB")));
    const rows = buildUnusualRows(strikes);
    expect(rows).toHaveLength(30);
    expect(rows.map((x) => x.rank)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(rows.some((x) => x.strike === 29000)).toBe(false);
  });

  test("oi=0 guard: volOi null, rank key falls back to raw volume", () => {
    const rows = buildUnusualRows([
      strikeAt(25700, side(5_000, 0, "LB"), side(3_000, 1_000, "SB")),
      strikeAt(25800, side(4_000, 1_000, "LB"), side(100, 100, "SB")),
    ]);
    const zero = rows.find((x) => x.key === "25700-CE")!;
    expect(zero.volOi).toBeNull();
    expect(zero.rankKey).toBe(5_000);
    // 5000 (volume fallback) outranks the 4.0 and 3.0 ratios
    expect(rows[0].key).toBe("25700-CE");
    expect(rows[0].rank).toBe(1);
  });

  test("share math is per-leg against that leg's chain total", () => {
    const rows = buildUnusualRows([
      strikeAt(25700, side(3_000, 1_000, "LB"), side(1_000, 1_000, "SB")),
      strikeAt(25800, side(1_000, 1_000, "LB"), side(3_000, 1_000, "SB")),
    ]);
    const ce = rows.find((x) => x.key === "25700-CE")!;
    const pe = rows.find((x) => x.key === "25800-PE")!;
    expect(ce.share).toBeCloseTo(75, 10);
    expect(pe.share).toBeCloseTo(75, 10);
  });

  test("empty input yields no rows; missing volume defaults to 0", () => {
    expect(buildUnusualRows([])).toEqual([]);
    const rows = buildUnusualRows([
      { strike: 25700, ce: { ltp: 1, close: 1, oi: 5, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "LB" }, pe: { ltp: 1, close: 1, oi: 5, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "SB" } },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => x.volume === 0 && x.share === 0)).toBe(true);
  });
});

describe("unusual formatting", () => {
  test("formatUnusualCompact uses M/K without sign", () => {
    expect(formatUnusualCompact(1_250_000)).toBe("1.25M");
    expect(formatUnusualCompact(850_000)).toBe("850.00K");
    expect(formatUnusualCompact(912)).toBe("912");
    expect(formatUnusualCompact(0)).toBe("0");
    expect(formatUnusualCompact(NaN)).toBe("—");
  });

  test("formatUnusualShare renders 1 decimal with pct", () => {
    expect(formatUnusualShare(12.345)).toBe("12.3%");
    expect(formatUnusualShare(0)).toBe("0.0%");
    expect(formatUnusualShare(NaN)).toBe("—");
  });
});

describe("unusual sentiment + ITM helpers", () => {
  test("full positioning names are defined", () => {
    expect(UNUSUAL_SENTIMENT_NAMES).toEqual({
      LB: "Long Buildup",
      SB: "Short Buildup",
      SC: "Short Cover",
      LU: "Long Unwind",
    });
  });

  test("per-side tone matches the OI panel convention", () => {
    // calls rise on buying: LB/SC bullish; puts rise on fear: SB/SC bullish
    expect(getUnusualSentimentTone("LB", "CE")).toBe(palette.POSITIVE);
    expect(getUnusualSentimentTone("SC", "CE")).toBe(palette.POSITIVE);
    expect(getUnusualSentimentTone("SB", "CE")).toBe(palette.NEGATIVE);
    expect(getUnusualSentimentTone("LU", "CE")).toBe(palette.NEGATIVE);
    expect(getUnusualSentimentTone("SB", "PE")).toBe(palette.POSITIVE);
    expect(getUnusualSentimentTone("SC", "PE")).toBe(palette.POSITIVE);
    expect(getUnusualSentimentTone("LB", "PE")).toBe(palette.NEGATIVE);
    expect(getUnusualSentimentTone("LU", "PE")).toBe(palette.NEGATIVE);
    expect(getUnusualSentimentTone("Neutral", "CE")).toBe(palette.TEXT_MUTED);
    expect(getUnusualSentimentTone("???", "PE")).toBe(palette.TEXT_MUTED);
  });

  test("isItmLeg: calls below spot, puts above spot", () => {
    expect(isItmLeg(25600, "CE", 25750)).toBe(true);
    expect(isItmLeg(25800, "CE", 25750)).toBe(false);
    expect(isItmLeg(25800, "PE", 25750)).toBe(true);
    expect(isItmLeg(25600, "PE", 25750)).toBe(false);
    expect(isItmLeg(25750, "CE", 25750)).toBe(false);
    expect(isItmLeg(25750, "PE", 25750)).toBe(false);
    expect(isItmLeg(25600, "CE", 0)).toBe(false);
  });

  test("every column declares explicit meta.align and a fixed width", () => {
    const cols = getNiftyUnusualColumns(1000);
    // 6, not 8: the leg is merged into the strike cell and Share moved to
    // the focus strip, so the table fits a narrow panel.
    expect(cols.length).toBe(6);
    for (const col of cols) {
      const meta = (col as { meta?: { align?: string } }).meta;
      expect(meta?.align).toMatch(/^(left|center|right)$/);
      const size = (col as { size?: number }).size;
      expect(typeof size).toBe("number");
      expect(size as number).toBeGreaterThan(0);
    }
    const byKey = new Map(
      cols.map((c) => [c.accessorKey as string, (c.meta as { align: string }).align]),
    );
    expect(byKey.get("rank")).toBe("center");
    expect(byKey.get("strike")).toBe("right");
    expect(byKey.get("volume")).toBe("right");
    expect(byKey.get("oi")).toBe("right");
    expect(byKey.get("volOi")).toBe("right");
    expect(byKey.get("sentiment")).toBe("center");
  });
});

describe("NiftyUnusualVolume render", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test("header shows compact CE/PE totals, top share and the rank caption", () => {
    r(
      <NiftyUnusualVolume
        spot={25750}
        strikes={[
          strikeAt(25700, side(1_250_000, 500_000, "LB"), side(850_000, 500_000, "SB")),
          strikeAt(25800, side(100_000, 500_000, "LB"), side(50_000, 500_000, "SB")),
        ]}
      />,
    );
    expect(screen.getByTestId("nifty-unusual-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-unusual-panel")).toHaveTextContent("Unusual volume");
    expect(screen.getByTestId("nifty-unusual-ce-vol")).toHaveTextContent("1.35M");
    expect(screen.getByTestId("nifty-unusual-pe-vol")).toHaveTextContent("900.00K");
    // rank #1 is 25700-CE (ratio 2.5): share = 1.25M / 1.35M
    expect(screen.getByTestId("nifty-unusual-top-share")).toHaveTextContent("92.6%");
    expect(screen.getByTestId("nifty-unusual-caption")).toHaveTextContent("ranked by Vol÷OI");
  });

  test("rows render in Vol÷OI order with pills, bars and full positioning names", () => {
    r(
      <NiftyUnusualVolume
        spot={25750}
        strikes={[
          strikeAt(25700, side(100_000, 10_000, "LB"), side(50_000, 50_000, "SB")),
          strikeAt(25800, side(90_000, 1_000, "SC"), side(1_000, 1_000, "LU")),
        ]}
      />,
    );
    const table = screen.getByTestId("nifty-unusual-table");
    const rows = within(table).getAllByTestId(/^nifty-unusual-row-/);
    expect(rows.map((el) => el.getAttribute("data-testid"))).toEqual([
      "nifty-unusual-row-25800-CE",
      "nifty-unusual-row-25700-CE",
      "nifty-unusual-row-25700-PE",
      "nifty-unusual-row-25800-PE",
    ]);
    expect(within(table).getByTestId("nifty-unusual-row-25800-CE")).toHaveTextContent("Short Cover");
    expect(within(table).getByTestId("nifty-unusual-row-25700-CE")).toHaveTextContent("Long Buildup");
    expect(within(table).getByTestId("nifty-unusual-row-25800-PE")).toHaveTextContent("Long Unwind");
    // CE/PE pills + volume bars exist for every leg
    expect(within(table).getByTestId("nifty-unusual-bar-25800-CE")).toBeInTheDocument();
    expect(within(table).getByTestId("nifty-unusual-bar-25700-PE")).toBeInTheDocument();
    // max-volume row fills its bar
    expect(within(table).getByTestId("nifty-unusual-bar-25700-CE")).toHaveStyle({ width: "100%" });
  });

  test("volume bars scale both length and fill opacity with size", () => {
    r(
      <NiftyUnusualVolume
        spot={25750}
        strikes={[
          strikeAt(25700, side(100_000, 10_000, "LB"), side(50_000, 50_000, "SB")),
          strikeAt(25800, side(10_000, 10_000, "LB"), side(5_000, 5_000, "SB")),
        ]}
      />,
    );
    const table = screen.getByTestId("nifty-unusual-table");
    const big = within(table).getByTestId("nifty-unusual-bar-25700-CE");
    const small = within(table).getByTestId("nifty-unusual-bar-25800-CE");
    // biggest leg fills 100% and is fully opaque (1); smaller leg fades.
    expect(Number(big.style.width.replace("%", ""))).toBeCloseTo(100, 5);
    expect(Number(big.style.opacity)).toBeCloseTo(1, 5);
    expect(Number(small.style.opacity)).toBeLessThan(Number(big.style.opacity));
    expect(Number(small.style.opacity)).toBeGreaterThan(0.3);
    expect(Number(small.style.width.replace("%", ""))).toBeLessThan(100);
  });

  test("oi=0 cell shows compact volume instead of a ratio", () => {
    r(
      <NiftyUnusualVolume
        spot={25750}
        strikes={[strikeAt(25700, side(5_000, 0, "LB"), side(3_000, 1_000, "SB"))]}
      />,
    );
    const table = screen.getByTestId("nifty-unusual-table");
    const ceRow = within(table).getByTestId("nifty-unusual-row-25700-CE");
    expect(ceRow).toHaveTextContent("5.00K");
    expect(ceRow).not.toHaveTextContent("NaN");
    // sibling with OI shows a 2dp ratio
    expect(within(table).getByTestId("nifty-unusual-row-25700-PE")).toHaveTextContent("3.00");
  });

  test("ITM-side rows carry the subtle tint, OTM rows do not", () => {
    r(
      <NiftyUnusualVolume
        spot={25750}
        strikes={[strikeAt(25700, side(9_000, 1_000, "LB"), side(9_000, 1_000, "SB"))]}
      />,
    );
    const table = screen.getByTestId("nifty-unusual-table");
    // 25700 CE is ITM (below spot), 25700 PE is OTM
    const ceRow = within(table).getByTestId("nifty-unusual-row-25700-CE");
    expect(ceRow.style.background).toMatch(/rgba/);
    const peRow = within(table).getByTestId("nifty-unusual-row-25700-PE");
    expect(peRow.style.background).toBe("");
  });

  test("empty chain renders the No-chain empty state", () => {
    r(<NiftyUnusualVolume spot={25750} strikes={[]} />);
    expect(screen.getByTestId("nifty-unusual-panel")).toBeInTheDocument();
    expect(screen.getByText("No chain data")).toBeInTheDocument();
    expect(screen.queryByTestId(/^nifty-unusual-row-/)).not.toBeInTheDocument();
    expect(screen.getByTestId("nifty-unusual-top-share")).toHaveTextContent("—");
    // no #1 leg → no focus strip
    expect(screen.queryByTestId("nifty-unusual-focus")).not.toBeInTheDocument();
  });
});

describe("NiftyUnusualVolume focus strip", () => {
  test("formatUnusualFocus renders every field in order from the built row", () => {
    const rows = buildUnusualRows([
      strikeAt(25700, side(100_000, 10_000, "LB"), side(50_000, 50_000, "SB")),
      strikeAt(25800, side(90_000, 1_000, "SC"), side(1_000, 1_000, "LU")),
    ]);
    // #1 is 25800-CE (ratio 90): 90k/1k, CE total 190k → 47.4%, +50 vs spot
    expect(formatUnusualFocus(rows[0], 25750)).toBe(
      "25,800 CE · VOL 90.00K · OI 1.00K · VOL÷OI 90.00x · SHARE 47.4% of CE vol · VS SPOT +50 pts · Short Cover",
    );
  });

  test("put leg shows of-PE-vol share, negative VS SPOT and full positioning name", () => {
    const rows = buildUnusualRows([
      strikeAt(25700, side(3_000, 1_000, "LB"), side(1_000, 1_000, "SB")),
      strikeAt(25800, side(1_000, 1_000, "LB"), side(3_000, 1_000, "SB")),
    ]);
    const pe = rows.find((x) => x.key === "25800-PE")!;
    expect(formatUnusualFocus(pe, 25750)).toBe(
      "25,800 PE · VOL 3.00K · OI 1.00K · VOL÷OI 3.00x · SHARE 75.0% of PE vol · VS SPOT +50 pts · Short Buildup",
    );
    const ce = rows.find((x) => x.key === "25700-CE")!;
    // 25700 is below spot 25750 → negative distance
    expect(formatUnusualFocus(ce, 25750)).toContain("VS SPOT -50 pts");
    expect(formatUnusualFocus(ce, 25750)).toContain("Long Buildup");
  });

  test("oi=0 leg falls back to compact volume for the ratio slot", () => {
    const rows = buildUnusualRows([
      strikeAt(25700, side(5_000, 0, "LB"), side(3_000, 1_000, "SB")),
    ]);
    expect(formatUnusualFocus(rows[0], 25750)).toContain("VOL÷OI 5.00K");
  });

  test("strip renders the #1 leg above the table, in rank order", () => {
    r(
      <NiftyUnusualVolume
        spot={25750}
        strikes={[
          strikeAt(25700, side(100_000, 10_000, "LB"), side(50_000, 50_000, "SB")),
          strikeAt(25800, side(90_000, 1_000, "SC"), side(1_000, 1_000, "LU")),
        ]}
      />,
    );
    const focus = screen.getByTestId("nifty-unusual-focus");
    expect(focus).toBeInTheDocument();
    expect(focus).toHaveTextContent(
      "25,800 CE · VOL 90.00K · OI 1.00K · VOL÷OI 90.00x · SHARE 47.4% of CE vol · VS SPOT +50 pts · Short Cover",
    );
    // strip sits between the head stats and the table
    const panel = screen.getByTestId("nifty-unusual-panel");
    const head = within(panel).getByTestId("nifty-unusual-head");
    const table = within(panel).getByTestId("nifty-unusual-table");
    expect(head.compareDocumentPosition(focus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(focus.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("NiftyReportPanel unusual-volume wiring", () => {
  function mockReport() {
    return {
      mode: "live",
      date: "2026-10-12",
      expiry: "weekly",
      spot: 25750.5,
      ohlc: { open: 25600, high: 25800, low: 25550, close: 25750.5 },
      pcrOi: 1.12,
      pcrVol: 0.95,
      maxPain: 25700,
      walls: { calls: [], puts: [] },
      strikes: [strikeAt(25700, side(9_000, 1_000, "LB"), side(8_000, 1_000, "SB"))],
      timeline: [],
    };
  }

  test("unusual panel renders directly after the OI tape panel", async () => {
    const { NiftyReportPanel } = await import("./NiftyReportPanel");
    const api = await import("@/api/reportNifty");
    vi.mocked(api.fetchLiveNifty).mockResolvedValue(mockReport() as never);
    vi.mocked(api.fetchNiftyTape).mockResolvedValue({ date: "2026-10-12", interval_sec: 60, rows: [] });
    r(<NiftyReportPanel />);
    const unusual = await screen.findByTestId("nifty-unusual-panel");
    expect(unusual).toBeInTheDocument();
    expect(within(unusual).getByTestId("nifty-unusual-table")).toBeInTheDocument();
    const tape = screen.getByTestId("nifty-tape-panel");
    expect(tape.compareDocumentPosition(unusual) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("last / next update stamp", () => {
  const T = Date.parse("2026-10-14T12:03:15+05:30");

  test("shows upd + next and keeps the rank caption", () => {
    r(
      <NiftyUnusualVolume
        spot={25750}
        strikes={[strikeAt(25700, side(9_000, 1_000, "LB"), side(8_000, 1_000, "SB"))]}
        updatedAtMs={T}
        nextUpdateAtMs={T + 30_000}
      />,
    );
    const el = screen.getByTestId("nifty-unusual-updated");
    expect(el).toHaveTextContent("upd 12:03:15");
    expect(el).toHaveTextContent("next 12:03:45");
    expect(screen.getByTestId("nifty-unusual-caption")).toHaveTextContent("ranked by Vol÷OI");
  });

  test("no stamp when no refresh time is supplied", () => {
    r(<NiftyUnusualVolume spot={25750} strikes={[strikeAt(25700)]} />);
    expect(screen.queryByTestId("nifty-unusual-updated")).not.toBeInTheDocument();
  });
});
