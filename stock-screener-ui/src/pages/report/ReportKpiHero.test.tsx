// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";
import type { NiftyReport } from "@/types/niftyReport";
import { REPORT_FONT, REPORT_GUTTER, REPORT_KPI_HERO_HEIGHT } from "./reportTokens";

const rawReport = {
  spot: 25_000,
  regime: { verdict: "trend_buy", rv: null, iv: null, range_pts: null },
  gex: { regime: "short", zeroCross: 25_100, strikes: [] },
  walls: {
    calls: [{ strike: 25_200, oi: 1200 }],
    puts: [{ strike: 24_800, oi: 900 }],
  },
  strikes: [],
  ohlc: { open: 24_900, low: 24_850, high: 25_050 },
  tape: [],
  intraday: [],
  candles: [],
};
const report = rawReport as unknown as NiftyReport;

interface MountProps {
  report?: NiftyReport | null;
  onToken?: (key: string) => void;
  decisionSlot?: unknown;
  statsToggle?: unknown;
  details?: unknown;
}

function mount(props: MountProps = {}) {
  return render(() => (
    <UIProvider>
      <ReportKpiHero
        report={props.report === undefined ? report : props.report}
        onToken={props.onToken}
        decisionSlot={props.decisionSlot as never}
        statsToggle={props.statsToggle as never}
        details={props.details as never}
      />
    </UIProvider>
  ));
}

afterEach(cleanup);

// Imported dynamically so this file is also a regression proving the module
// did not exist before the A+B hero landed.
const { ReportKpiHero, spotSnapshot } = await import("./ReportKpiHero");

describe("ReportKpiHero — compact decision band", () => {
  test("is one compact 32px band, not the old 56px banner", () => {
    mount();
    const hero = screen.getByTestId("nifty-kpi-hero");
    expect(REPORT_KPI_HERO_HEIGHT).toBe(32);
    expect(hero.style.height).toBe("32px");
    expect(hero.style.minHeight).toBe("32px");
    expect(hero.className).toContain("flex-nowrap");
    expect(hero.className).not.toContain("max-[600px]:flex-wrap");
    expect(hero.className).not.toContain("h-auto!");
    expect(hero.className).not.toContain("overflow-x-auto");
  });

  test("carries four compact tokens and no CONFIDENCE token", () => {
    mount();
    const hero = screen.getByTestId("nifty-kpi-hero");
    for (const label of ["SPOT", "REGIME", "GAMMA FLIP", "WALLS"]) {
      expect(screen.getByTestId(`nifty-kpi-${label.toLowerCase().replace(/\s/g, "-")}`), label)
        .toBeInTheDocument();
    }
    expect(
      hero.querySelectorAll("[data-testid^='nifty-kpi-']:not([data-testid='nifty-kpi-tokens'])"),
    ).toHaveLength(4);
    expect(screen.queryByTestId("nifty-kpi-confidence")).not.toBeInTheDocument();
    // The old label + `confidence 83%` value read as "confidence confidence".
    expect(hero.textContent!.toLowerCase()).not.toContain("confidence confidence");
  });

  test("cells stay left-aligned as four distinct caption/value groups", () => {
    mount();
    const row = screen.getByTestId("nifty-kpi-tokens");
    expect(row.className).toContain("justify-start");
    expect(row.className).not.toContain("ml-auto");
    const cells = ["spot", "regime", "gamma-flip", "walls"].map((key) =>
      screen.getByTestId(`nifty-kpi-${key}`),
    );
    for (const cell of cells) expect(cell.className).toContain("flex-col");
    expect(cells.map((cell) => cell.textContent)).toEqual([
      "SPOT25,000",
      "REGIMETREND",
      "GAMMA FLIP25,100",
      "WALLS25,200/24,800",
    ]);
    expect(row.textContent).not.toContain(" · ");
    expect(row.querySelectorAll("[data-kpi-divider]")).toHaveLength(3);
  });

  test("shows dashes for an empty report and never invents a value", () => {
    cleanup();
    mount({ report: null });
    for (const token of ["spot", "regime", "gamma-flip", "walls"]) {
      expect(screen.getByTestId(`nifty-kpi-${token}`)).toHaveTextContent("—");
    }
    expect(screen.getByTestId("nifty-kpi-hero").textContent).not.toMatch(/[\d,]/);
  });

  test("token buttons open their drawers and non-actionable tokens are plain text", () => {
    const onToken = vi.fn();
    mount({ onToken });
    screen.getByTestId("nifty-kpi-walls").click();
    expect(onToken).toHaveBeenCalledWith("walls");
    expect(screen.getByTestId("nifty-kpi-spot").tagName).not.toBe("BUTTON");
  });

  test("uses palette tokens only — no private colour literal", () => {
    const source = readFileSync(join(process.cwd(), "src/pages/report/ReportKpiHero.tsx"), "utf8");
    expect(source).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    expect(source).toContain("palette.");
  });
});

describe("ReportKpiHero — composed 32px band", () => {
  test("is a 32px single-row band with four captioned cells and hairline dividers", () => {
    mount({
      decisionSlot: <span data-testid="decision-slot-stub">levels</span>,
      statsToggle: <button type="button" data-testid="nifty-live-tape-toggle">ALL STATS</button>,
    });

    const hero = screen.getByTestId("nifty-kpi-hero");
    expect(REPORT_KPI_HERO_HEIGHT).toBe(32);
    expect(hero.style.height).toBe("32px");
    expect(hero.style.minHeight).toBe("32px");
    expect(hero.style.backgroundColor).toBe(palette.SURFACE_ALT);
    expect(hero.style.boxShadow).toContain(palette.BORDER);
    expect(hero.querySelectorAll("[data-kpi-divider]")).toHaveLength(3);

    const spot = screen.getByTestId("nifty-kpi-spot");
    expect(spot.className).toContain("flex-col");
    expect(Array.from(spot.children).map((el) => el.textContent)).toEqual(["SPOT", "25,000"]);
    expect(screen.getByTestId("nifty-kpi-tokens").textContent).not.toContain(" · ");
    expect(screen.getByTestId("decision-slot-stub").parentElement).not.toBe(hero);
  });
});

describe("ReportKpiHero — shared spot snapshot descriptor", () => {
  test("one descriptor explains the whole-point KPI against the 2dp walls/chart spot", () => {
    const view = spotSnapshot(25_976.1, { digits: 0, asOf: "11:44", origin: "Snapshot" });
    expect(view.display).toBe("25,976");
    expect(view.exact).toBe("25,976.10");
    expect(view.title).toContain("Snapshot 11:44");
    expect(view.title).toContain("25,976.10");
    expect(view.title).toContain("whole points");

    const precise = spotSnapshot(25_976.1, { digits: 2, asOf: "11:44", origin: "Snapshot" });
    expect(precise.display).toBe("25,976.10");
    expect(precise.exact).toBe(view.exact);
    expect(precise.title).toContain("Snapshot 11:44");
  });

  test("the SPOT cell keeps its number but its title carries the snapshot instant", () => {
    mount({
      report: {
        ...report,
        spot: 25_976.1,
        snapshotAt: "2026-11-23T11:44:00+05:30",
      } as unknown as NiftyReport,
    });
    const spot = screen.getByTestId("nifty-kpi-spot");
    expect(spot).toHaveTextContent("25,976");
    expect(spot.getAttribute("title")).toContain("Snapshot 11:44");
    expect(spot.getAttribute("title")).toContain("25,976.10");
    expect(spot.getAttribute("title")).toContain("whole points");
  });
});

describe("ReportKpiHero — fixed band, composed detail", () => {
  test("the band never grows in flow when detail is expanded", () => {
    mount({
      expand: true,
      details: <span data-testid="hero-detail-stub">detail</span>,
      decisionSlot: <span data-testid="left-stub">call</span>,
    });
    const hero = screen.getByTestId("nifty-kpi-hero");
    expect(hero.style.height).toBe("32px");
    expect(hero.style.minHeight).toBe("32px");
    expect(hero.className).toContain("flex-nowrap");
    expect(hero.className).toContain("items-center");
    expect(hero.className).not.toContain("h-auto!");
    // In-flow detail is what turned the 32px band into a run-on block.
    expect(screen.queryByTestId("hero-detail-stub")).not.toBeInTheDocument();
  });

  test("the call group and the four KPI cells are separate flex cells with one gutter", () => {
    mount({
      decisionSlot: <span data-testid="left-stub">call</span>,
      statsToggle: <button type="button" data-testid="nifty-live-tape-toggle">ALL STATS</button>,
    });
    const hero = screen.getByTestId("nifty-kpi-hero");
    expect(hero.style.gap).toBe(`${REPORT_GUTTER.inline}px`);
    const [left, right] = Array.from(hero.children) as HTMLElement[];
    expect(left.className).toContain("flex-1");
    expect(left.className).toContain("min-w-0");
    expect(left.contains(screen.getByTestId("left-stub"))).toBe(true);
    expect(right).toBe(screen.getByTestId("nifty-kpi-tokens"));
    expect(right.className).toContain("shrink-0");
  });

  test("each KPI cell is a caption above a tabular mono value", () => {
    mount();
    for (const key of ["spot", "regime", "gamma-flip", "walls"]) {
      const cell = screen.getByTestId(`nifty-kpi-${key}`);
      const [caption, value] = Array.from(cell.children) as HTMLElement[];
      expect(caption.style.fontSize, key).toBe(`${REPORT_FONT.micro}px`);
      expect(caption.style.textTransform, key).toBe("uppercase");
      expect(value.style.fontSize, key).toBe(`${REPORT_FONT.body}px`);
      expect(value.style.fontVariantNumeric, key).toBe("tabular-nums");
      expect(value.style.whiteSpace, key).toBe("nowrap");
    }
  });
});
