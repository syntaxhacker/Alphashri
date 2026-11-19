// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@/state/auth", () => ({ fetchWithAuth: vi.fn() }));

import { normalizeReport } from "@/api/reportNifty";
import { UIProvider } from "@/ui";
import { NiftyOiHeatmap } from "./NiftyOiHeatmap";
import { NiftyVerdictStrip } from "./NiftyVerdictStrip";
import { getNiftyOiColumns } from "./reportCells";
import { chainAt, isoAt, r } from "./reportTestFixtures";

afterEach(cleanup);

const STRIKES = [25650, 25700, 25750, 25800, 25850];
const rows = [
  { t: isoAt(0), spot: 25750, chain: chainAt(STRIKES, 1000, 1000) },
  {
    t: isoAt(6),
    spot: 25760,
    chain: {
      ...chainAt(STRIKES, 1000, 1000),
      "25750": [10, 12, 6000, 1000, 1, 1],
      "25700": [10, 12, 1000, 5000, 1, 1],
    },
  },
] as never;

function verdictReport() {
  return normalizeReport({
    control: {
      verdict: "call_writers",
      ce_doi: 5_530_000,
      pe_doi: -1_200_000,
      atm_ce_iv: 12.5,
      atm_pe_iv: 13.1,
      skew: -2.4,
      gex_regime: "short",
    },
    vix: { ltp: 13.45, prev_close: 13.8, change_pct: -2.54, day_high: 13.9, day_low: 13.2 },
  } as Record<string, unknown>);
}

describe("verdict detail in the compact context row", () => {
  test("the secondary detail is suppressed, not cut mid-number; full text and tooltip survive", () => {
    render(() => (
      <UIProvider>
        <NiftyVerdictStrip report={verdictReport()} mode="context" />
      </UIProvider>
    ));

    const control = screen.getByTestId("nifty-verdict-control");
    const secondary = within(control).getByTestId("nifty-verdict-control-secondary");
    const expected = "ΔOI (chain) C +5.5M P -1.2M · skew -2.40";

    expect(secondary).toHaveTextContent(expected);
    expect(secondary.textContent).toBe(expected);
    // A deliberate suppression, never a 47px ellipsis on a number.
    expect(secondary).toHaveClass("sr-only");
    expect(secondary.style.textOverflow).toBe("");
    expect(secondary.style.whiteSpace).toBe("");
    expect(secondary.style.fontSize).toBe("11px");
    expect(control).toHaveAttribute("title", expect.stringContaining(expected));

    // The primary verdict stays intact — only the detail line is dropped.
    expect(within(control).getByTestId("nifty-verdict-control-primary")).toHaveTextContent(
      "SESSION · CALL WRITING",
    );
    const vixSecondary = within(screen.getByTestId("nifty-verdict-vix")).getByTestId(
      "nifty-verdict-vix-secondary",
    );
    expect(vixSecondary).toHaveTextContent("day 13.20–13.90");
    expect(vixSecondary).toHaveClass("sr-only");
  });

  test("the full strip keeps its detail as a wrapping line at 11px", () => {
    render(() => (
      <UIProvider>
        <NiftyVerdictStrip report={verdictReport()} />
      </UIProvider>
    ));
    const regime = screen.getByTestId("nifty-verdict-regime-secondary");
    expect(regime.style.fontSize).toBe("11px");
    expect(regime.style.whiteSpace).toBe("normal");
    expect(regime.style.textOverflow).toBe("");
  });
});

describe("heatmap read + axis legibility", () => {
  test("the read wraps instead of clipping its last clause", () => {
    r(() => <NiftyOiHeatmap rows={rows} bucketMin={5} widthPts={500} />);
    const read = screen.getByTestId("nifty-heatmap-read");
    expect(read).toHaveClass("whitespace-normal");
    expect(read).not.toHaveClass("whitespace-nowrap");
    expect(read).not.toHaveClass("text-ellipsis");
    expect(read).toHaveClass("break-words");
    expect(read.textContent?.length).toBeGreaterThan(40);
  });

  test("the strike and ΔOI labels fit their boxes at the 11px floor", () => {
    r(() => <NiftyOiHeatmap rows={rows} bucketMin={5} widthPts={500} />);
    for (const el of screen.getAllByTestId("nifty-heatmap-strike-label")) {
      expect(el.getAttribute("font-size")).toBe("11");
      // Vertically centred in its own row: no glyph sits under the next label.
      expect(el.getAttribute("dominant-baseline")).toBe("middle");
      expect(Number(el.getAttribute("y"))).toBeGreaterThan(0);
      expect(Number(el.getAttribute("y"))).toBeLessThan(150);
    }
    const oi = screen.getByTestId("nifty-heatmap-oi-label");
    expect(oi).toHaveTextContent("ΔOI");
    expect(oi.getAttribute("font-size")).toBe("11");
    expect(oi.getAttribute("dominant-baseline")).toBe("middle");
    // The rotated caption is moved off the SVG edge so no glyph is clipped.
    expect(Number(oi.getAttribute("x"))).toBeGreaterThanOrEqual(14);
    expect(screen.getByTestId("nifty-heatmap-time-axis").getAttribute("font-size")).toBe("11");
  });
});

describe("alignment and ticker overflow verdict", () => {
  test("OI chain columns align numbers right and sentiment badges centre", () => {
    for (const column of getNiftyOiColumns(null)) {
      if (column.id.includes("Signal")) expect(column.meta?.align).toBe("center");
      else expect(column.meta?.align).toBe("right");
    }
  });

  test("market-ticker overflow is a deliberate horizontal scroll strip", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/layout/MarketTicker.tsx"),
      "utf8",
    );
    expect(source).toContain('"overflow-x": "auto"');
    expect(source).toContain('"flex-wrap": "nowrap"');
  });
});

describe("report typography floor", () => {
  const HERE = resolve(process.cwd(), "src/pages/report");
  const FILES = [
    "ReportDecisionStrip.tsx",
    "NiftyVerdictStrip.tsx",
    "NiftyOiHeatmap.tsx",
    "NiftyIntelStrip.tsx",
    "IndexMoversStrip.tsx",
    "BreadthStrip.tsx",
    "reportCells.tsx",
  ];
  const FONT_SIZE =
    /text-\[(\d+(?:\.\d+)?)px\]|"font-size":\s*"(\d+(?:\.\d+)?)px"|fontSize:\s*(\d+(?:\.\d+)?)\b|font-size="(\d+(?:\.\d+)?)"/g;

  test("no report text is below 11px in the legibility lane's files", () => {
    const offenders = FILES.flatMap((file) =>
      readFileSync(resolve(HERE, file), "utf8")
        .split("\n")
        .flatMap((line, i) =>
          [...line.matchAll(FONT_SIZE)]
            .map((m) => Number(m[1] ?? m[2] ?? m[3] ?? m[4]))
            .filter((px) => px < 11)
            .map((px) => `${file}:${i + 1} (${px}px)`),
        ),
    );
    expect(offenders, `\n${offenders.join("\n")}`).toEqual([]);
  });
});
