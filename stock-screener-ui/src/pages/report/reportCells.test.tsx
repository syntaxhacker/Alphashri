import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, test } from "vitest";
import type { NiftyReport, NiftyStrike } from "@/types/niftyReport";
import { setLiveTick } from "./niftyStreamSolid";
import {
  ContextCell,
  DecisionCell,
  DecisionChip,
  NiftyOiChain,
  NiftySpotValue,
  buildOvernightLevels,
  findAtmStrike,
  formatGexLevel,
  formatGexTotal,
  formatOiCr,
  formatSignedPoints,
  getNiftyOiColumns,
  gexRegimeText,
  oiBurstLogHeight,
  setupBannerHeadline,
} from "./reportCells";

afterEach(() => {
  setLiveTick(null);
  cleanup();
});

function strikeAt(strike: number): NiftyStrike {
  return { strike } as NiftyStrike;
}

function chainRow(strike: number): NiftyStrike {
  return {
    strike,
    ce: {
      ltp: 150,
      close: 200,
      oi: 2000,
      prevOi: 1800,
      oiChange: 200,
      priceChange: -50,
      sentiment: "LB",
    },
    pe: {
      ltp: 260,
      close: 200,
      oi: 2500,
      prevOi: 2600,
      oiChange: -100,
      priceChange: 60,
      sentiment: "SB",
    },
  };
}

function reportWith(over: Partial<NiftyReport>): NiftyReport {
  return {
    mode: "live",
    date: "2026-01-05",
    expiry: "2026-01-08",
    spot: 25000,
    pcrOi: 0.85,
    pcrVol: 0.9,
    maxPain: 25000,
    walls: { calls: [], puts: [] },
    strikes: [],
    timeline: [],
    ohlc: { open: 25000, high: 25000, low: 25000, close: 25000 },
    ...over,
  } as NiftyReport;
}

describe("formatSignedPoints", () => {
  test("signs the rounded points and groups the integer part", () => {
    expect(formatSignedPoints(733)).toBe("+733 pts");
    expect(formatSignedPoints(1250.6)).toBe("+1,251 pts");
    expect(formatSignedPoints(-139.2)).toBe("-139 pts");
    expect(formatSignedPoints(0)).toBe("0 pts");
    expect(formatSignedPoints(100000)).toBe("+1,00,000 pts");
  });
});

describe("formatOiCr", () => {
  test("compacts crores and lakhs, dashes anything unusable", () => {
    expect(formatOiCr(2.69e7)).toBe("2.69 Cr");
    expect(formatOiCr(1.84e5)).toBe("1.8 L");
    expect(formatOiCr(45000)).toBe("45,000");
    expect(formatOiCr(0)).toBe("—");
    expect(formatOiCr(-5)).toBe("—");
    expect(formatOiCr(null)).toBe("—");
    expect(formatOiCr(undefined)).toBe("—");
    expect(formatOiCr(Number.NaN)).toBe("—");
  });
});

describe("findAtmStrike", () => {
  test("picks the closest strike, lower on a tie, null without data", () => {
    expect(findAtmStrike([], 25750)).toBeNull();
    expect(findAtmStrike([strikeAt(25700)], Number.NaN)).toBeNull();
    expect(findAtmStrike([strikeAt(25700), strikeAt(25800)], 25730)).toBe(25700);
    expect(findAtmStrike([strikeAt(25700), strikeAt(25800)], 25780)).toBe(25800);
    expect(findAtmStrike([strikeAt(25800), strikeAt(25700)], 25750)).toBe(25700);
    expect(findAtmStrike([strikeAt(25000), strikeAt(25700), strikeAt(25800)], 25690)).toBe(25700);
  });
});

describe("setupBannerHeadline", () => {
  test("a live flip outranks arming and names its reason", () => {
    expect(setupBannerHeadline(true, "5m vs session", 5, 11)).toBe(
      "FLOW FLIP · 5m vs session — setup paused",
    );
    expect(setupBannerHeadline(true, null, 5, 11)).toBe(
      "FLOW FLIP · 5m vs 15m — setup paused",
    );
    expect(setupBannerHeadline(false, "5m vs session", 5, 11)).toBe("⏳ SETUP ARMING 5/11");
  });
});

describe("buildOvernightLevels", () => {
  test("derives resistance and support from the live walls", () => {
    const levels = buildOvernightLevels(
      reportWith({
        walls: {
          calls: [
            { strike: 25500, oi: 1 },
            { strike: 25200, oi: 2 },
            { strike: 25300, oi: 3 },
          ],
          puts: [
            { strike: 24800, oi: 1 },
            { strike: 24600, oi: 2 },
            { strike: 24900, oi: 3 },
          ],
        },
      }),
    );
    expect(levels.resistance).toEqual([
      { strike: 25200, pct: 0.8 },
      { strike: 25300, pct: 1.2 },
    ]);
    expect(levels.support).toEqual([
      { strike: 24900, pct: -0.4 },
      { strike: 24800, pct: -0.8 },
    ]);
    expect(levels.painPull.dir).toBe("flat");
    expect(levels.painPull.pct).toBe(0);
    expect(levels.pcrVerdict).toBe("Neutral (PCR-OI 0.85)");
  });

  test("empty walls and a missing PCR degrade without throwing", () => {
    const flat = buildOvernightLevels(reportWith({}));
    expect(flat.resistance).toEqual([]);
    expect(flat.support).toEqual([]);
    expect(flat.pcrVerdict).toBe("Neutral (PCR-OI 0.85)");

    const missing = buildOvernightLevels(
      reportWith({ pcrOi: Number.NaN, walls: undefined as unknown as NiftyReport["walls"] }),
    );
    expect(missing.pcrVerdict).toBe("PCR-OI n/a — chain incomplete");

    expect(buildOvernightLevels(reportWith({ pcrOi: 0.5 })).pcrVerdict).toBe(
      "Bearish (PCR-OI 0.50 — call writers in control)",
    );
    expect(buildOvernightLevels(reportWith({ pcrOi: 1.2 })).pcrVerdict).toBe(
      "Bullish (PCR-OI 1.20 — put writers in control)",
    );
  });

  test("max pain above and below spot sets the pull direction", () => {
    expect(buildOvernightLevels(reportWith({ maxPain: 25100 })).painPull.dir).toBe("up");
    expect(buildOvernightLevels(reportWith({ maxPain: 24900 })).painPull.dir).toBe("down");
    expect(buildOvernightLevels(reportWith({ spot: 0, maxPain: 25000 })).painPull.pct).toBe(0);
  });
});

describe("gex copy", () => {
  test("regime line for long, short and flat", () => {
    expect(gexRegimeText("long")).toBe("Dealers LONG gamma — moves dampened");
    expect(gexRegimeText("short")).toBe("Dealers SHORT gamma — moves amplified");
    expect(gexRegimeText("flat")).toBe("Flat");
    expect(gexRegimeText("")).toBe("Flat");
  });

  test("signed Cr/pt total", () => {
    expect(formatGexTotal(12.4)).toBe("+12.40 Cr/pt");
    expect(formatGexTotal(0)).toBe("+0.00 Cr/pt");
    expect(formatGexTotal(-3.456)).toBe("-3.46 Cr/pt");
  });

  test("strike plus signed exposure", () => {
    expect(formatGexLevel(25700, 5.2)).toBe("25,700 (+5.20 Cr)");
    expect(formatGexLevel(25700, -5.2)).toBe("25,700 (-5.20 Cr)");
    expect(formatGexLevel(0, 0)).toBe("0 (+0.00 Cr)");
  });
});

describe("oiBurstLogHeight", () => {
  test("grows 20px per alert and caps at 140", () => {
    expect(oiBurstLogHeight(0)).toBe(40);
    expect(oiBurstLogHeight(1)).toBe(60);
    expect(oiBurstLogHeight(2)).toBe(80);
    expect(oiBurstLogHeight(5)).toBe(140);
    expect(oiBurstLogHeight(50)).toBe(140);
  });
});

describe("decision strip cells", () => {
  test("DecisionCell repaints when the value prop changes", () => {
    const [value, setValue] = createSignal<string>("25,700");
    render(() => (
      <DecisionCell
        testId="decision-spot"
        label="SPOT"
        value={value()}
        hint="live last price"
        valueSize={15}
      />
    ));

    expect(screen.getByTestId("decision-spot")).toHaveTextContent("SPOT");
    expect(screen.getByTestId("decision-spot-value")).toHaveTextContent("25,700");
    expect(screen.getByTestId("decision-spot")).toHaveAttribute(
      "title",
      "SPOT: live last price",
    );

    setValue("25,750.35");
    expect(screen.getByTestId("decision-spot-value")).toHaveTextContent("25,750.35");
    expect(screen.getByTestId("decision-spot-value")).not.toHaveTextContent("25,700");
  });

  test("DecisionCell honours the accent and the explicit title", () => {
    render(() => (
      <DecisionCell
        testId="decision-gex"
        label="GEX FLIP"
        value="25,642"
        hint="zero gamma"
        title="Gamma flip"
        accent="#FF8A3D"
      />
    ));

    expect(screen.getByTestId("decision-gex")).toHaveAttribute(
      "title",
      "Gamma flip — zero gamma",
    );
    expect(screen.getByTestId("decision-gex-value")).toHaveStyle({ color: "#FF8A3D" });
  });

  test("ContextCell repaints when the value prop changes", () => {
    const [value, setValue] = createSignal<string>("1.08");
    render(() => <ContextCell testId="context-pcr" label="PCR" value={value()} />);

    expect(screen.getByTestId("context-pcr")).toHaveTextContent("PCR");
    expect(screen.getByTestId("context-pcr")).toHaveTextContent("1.08");

    setValue("1.12");
    expect(screen.getByTestId("context-pcr")).toHaveTextContent("1.12");
    expect(screen.getByTestId("context-pcr")).not.toHaveTextContent("1.08");
  });

  test("DecisionChip repaints its value and keeps the click handler", () => {
    const [value, setValue] = createSignal<string>("+2.4");
    let clicks = 0;
    render(() => (
      <DecisionChip
        testId="chip-flow"
        label="FLOW"
        value={value()}
        tone="#00C98D"
        onClick={() => {
          clicks += 1;
        }}
      />
    ));

    expect(screen.getByTestId("chip-flow")).toHaveTextContent("FLOW");
    expect(screen.getByTestId("chip-flow")).toHaveTextContent("+2.4");

    setValue("-1.9");
    expect(screen.getByTestId("chip-flow")).toHaveTextContent("-1.9");
    expect(screen.getByTestId("chip-flow")).not.toHaveTextContent("+2.4");

    fireEvent.click(screen.getByTestId("chip-flow"));
    expect(clicks).toBe(1);
  });
});

describe("NiftyOiChain", () => {
  test("renders the chain, wires the wrap ref and the expand action", () => {
    let wrapEl: HTMLDivElement | undefined;
    let expanded = 0;
    render(() => (
      <NiftyOiChain
        strikes={[chainRow(25700)]}
        columns={getNiftyOiColumns(25700, {
          maxCeOiChange: 200,
          maxPeOiChange: 100,
          spot: 25750,
          walls: { calls: [{ strike: 25700 }], puts: [{ strike: 25600 }] },
        })}
        getRowStyle={() => undefined}
        getRowTestId={() => "nifty-oi-row"}
        panelTestId="nifty-oi-panel"
        tableTestId="nifty-oi-table"
        wrapTestId="nifty-oi-wrap"
        wrapRef={(el) => {
          wrapEl = el;
        }}
        onExpand={() => {
          expanded += 1;
        }}
      />
    ));

    expect(screen.getByTestId("nifty-oi-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-oi-wrap")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-oi-table")).toHaveTextContent("25,700");
    expect(screen.getByTestId("nifty-oi-table")).toHaveTextContent("CW");
    expect(wrapEl).toBeInstanceOf(HTMLDivElement);

    fireEvent.click(screen.getByTestId("nifty-oi-expand"));
    expect(expanded).toBe(1);
  });
});

describe("NiftySpotValue", () => {
  test("follows the live tick and falls back to the report spot", () => {
    setLiveTick(null);
    const [live, setLive] = createSignal(false);
    const { container } = render(() => (
      <NiftySpotValue live={live()} fallback={25000} />
    ));

    expect(container.textContent).toBe("25,000");

    setLive(true);
    setLiveTick({ spot: 25123.45, ts: null, change_pct: 0.5 });
    expect(container.textContent).toBe("25,123.45");

    setLiveTick({ spot: 25201.5, ts: null, change_pct: 0.8 });
    expect(container.textContent).toBe("25,201.5");
    expect(container.textContent).not.toBe("25,123.45");
  });

  test("a second render with different props shows the new fallback", () => {
    const [fallback, setFallback] = createSignal(24800);
    const { container } = render(() => (
      <NiftySpotValue live={false} fallback={fallback()} />
    ));

    expect(container.textContent).toBe("24,800");

    setFallback(24975.5);
    expect(container.textContent).toBe("24,975.5");
    expect(container.textContent).not.toBe("24,800");
  });
});
