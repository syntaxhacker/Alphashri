// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";
import { UIProvider } from "@/ui";

vi.mock("@/state/auth", () => ({ fetchWithAuth: vi.fn() }));

const h = vi.hoisted(() => ({
  store: {
    data: {
      report: () => ({
        spot: 25_000,
        strikes: [],
        gex: null,
        walls: null,
        wallsNear: null,
        ohlc: { low: 24_900, high: 25_100 },
        pcrOi: 1,
        pcrVol: 0.9,
        maxPain: 25_000,
        market: {},
        positioning: {},
      }),
      metrics: () => null,
      tapeRows: () => [
        { pcr_oi: 0.9, max_pain: 24_900 },
        { pcr_oi: 1.1, max_pain: 25_100 },
      ],
      setup: () => ({ gates: [] }),
      preMove: () => ({ state: "none" }),
      tapeSpeed: () => null,
      lastFlip: () => null,
      flowReport: () => null,
    },
    ui: {
      isDesk: () => true,
      openPlanReasons: () => {},
      setDeskDockTab: () => {},
      setGammaOpen: () => {},
      openMovers: () => {},
    },
    selection: {
      symbol: () => "NIFTY",
      mode: () => "live",
      expiry: () => "nearest",
      date: () => null,
    },
  },
}));

vi.mock("./ReportContext", () => ({ useNiftyReport: () => h.store }));
vi.mock("./deskPlan", () => ({
  buildDeskPlan: () => ({
    bias: "neutral",
    spot: 25_000,
    bull: { action: "buy", entryTrigger: 0, stop: 0, target: 0, rr: 0, reasons: [] },
    bear: { action: "sell", entryTrigger: 0, stop: 0, target: 0, rr: 0, reasons: [] },
  }),
}));
vi.mock("./deskPlanSummary", () => ({
  summarizeDeskPlan: () => ({
    headline: "NEUTRAL · no trade — wait for a trigger",
    confidence: 0,
    tone: "neutral",
    action: "wait",
  }),
}));
vi.mock("./NiftyVerdictStrip", () => ({
  NiftyVerdictStrip: () => <div data-testid="nifty-verdict-strip" />,
  resolveRegimeLabel: () => "NEUTRAL",
  regimeAccent: () => "currentColor",
  regimeDetail: () => "detail",
}));
vi.mock("./niftyGex", () => ({ gexFlipAtSpot: () => null }));
vi.mock("./niftyPin", () => ({ pinRisk: () => null, pinHint: () => "" }));
vi.mock("./niftyWallsFormat", () => ({ resolveWallBoard: () => null }));
vi.mock("./NiftyFlowWindows", () => ({ NiftyFlowWindows: () => null }));
vi.mock("./IndexMoversStrip", () => ({ IndexMoversStrip: () => null }));
vi.mock("./NiftyIntelStrip", () => ({ NiftyIntelStrip: () => null }));
vi.mock("./NiftyGammaStrip", () => ({ NiftyGammaStrip: () => null }));
vi.mock("./SetupRadarStrip", () => ({ SetupRadarStrip: () => null }));
vi.mock("./reportBits", () => ({
  LiveTapeDisclosure: (props: any) => <div data-testid={props.testId}>{props.children}</div>,
}));

import { FLOW_CELLS_MAX_WIDTH, ReportDecisionStrip, statStripGaps } from "./ReportDecisionStrip";
import {
  REPORT_STRIP_METRICS,
  REPORT_STRIP_CELL_MIN,
  REPORT_STRIP_GROUP_WEIGHT,
  REPORT_FONT,
  groupCellGap,
} from "./reportTokens";

function mount() {
  return render(() => (
    <UIProvider>
      <ReportDecisionStrip />
    </UIProvider>
  ));
}

const GROUP_IDS = [
  "nifty-stat-group-price",
  "nifty-stat-group-walls",
  "nifty-stat-group-volatility",
  "nifty-stat-group-flow",
];

const GROUP_LABELS = ["PRICE", "WALLS", "VOLATILITY", "FLOW & ACTION"];
const CELL_ROW_IDS = [
  "nifty-stat-group-price-cells",
  "nifty-stat-group-walls-cells",
  "nifty-context-stats",
  "nifty-stat-group-flow-cells",
];

function groupsInDom() {
  return GROUP_IDS.map((id, index) => {
    const group = screen.getByTestId(id);
    const cellsRow = group.querySelector(`[data-testid="${CELL_ROW_IDS[index]}"]`);
    const cells = Array.from(cellsRow?.children ?? []) as HTMLElement[];
    return { id, group, cellsRow, cells };
  });
}

afterEach(cleanup);

describe("Index Report decision strip — grouped geometry", () => {
  test("(a) the four group labels exist in reading order", () => {
    mount();
    const strip = screen.getByTestId("nifty-stat-strip");
    const labels = GROUP_IDS.map((id) => strip.querySelector(`[data-testid="${id}-label"]`));
    for (const label of labels) expect(label, "group label").not.toBeNull();
    expect(labels.map((el) => el!.textContent)).toEqual(GROUP_LABELS);
    // DOM order matches the measured reading order.
    const all = Array.from(strip.querySelectorAll("[data-testid]")).map((el) =>
      el.getAttribute("data-testid"),
    );
    expect(GROUP_IDS.map((id) => all.indexOf(id))).toEqual([...all]
      .filter((id) => GROUP_IDS.includes(id ?? ""))
      .map((id) => all.indexOf(id)));
  });

  test("(b) no gap between adjacent cells — or to the strip edge — exceeds 8px", () => {
    mount();
    const gaps = statStripGaps();
    expect(gaps.withinGroup).toBeLessThanOrEqual(8);
    expect(gaps.betweenGroups).toBeLessThanOrEqual(8);
    expect(gaps.trailing).toBeLessThanOrEqual(8);
    expect(gaps.betweenGroups).toBe(
      REPORT_STRIP_METRICS.groupRowGap +
        REPORT_STRIP_METRICS.groupHairline +
        REPORT_STRIP_METRICS.groupInset,
    );
    expect(groupCellGap()).toBe(REPORT_STRIP_METRICS.groupGap);

    // Walk the rendered cells and derive their edge-to-edge gaps from the
    // actual inline styles the layout uses (happy-dom has no layout engine).
    const groups = groupsInDom().filter((g) => g.cells.length > 0);
    const rowGap = Number.parseFloat(screen.getByTestId("nifty-decision-stats").style.gap);
    expect(rowGap).toBe(REPORT_STRIP_METRICS.groupRowGap);

    const measures: number[] = [];
    for (const g of groups) {
      const cellGap = Number.parseFloat((g.cellsRow as HTMLElement).style.gap);
      expect(cellGap).toBe(REPORT_STRIP_METRICS.cellGap);
      for (let i = 1; i < g.cells.length; i += 1) measures.push(cellGap);
      if (g.group.style.borderLeft) {
        measures.push(
          rowGap +
            Number.parseFloat(g.group.style.borderLeftWidth || "0") +
            Number.parseFloat(g.group.style.paddingLeft),
        );
      }
    }
    expect(measures.length).toBeGreaterThan(0);
    for (const gap of measures) expect(gap).toBeLessThanOrEqual(8);

    // No ml-auto / wide-gap utilities that used to strand a dead zone.
    expect(screen.getByTestId("nifty-stat-strip").className).toContain("px-2");
    expect(screen.getByTestId("nifty-stat-group-price").className).not.toContain("ml-auto");
    // Intrinsic-width chips used to stop 7px short of the group's right edge.
    for (const id of ["nifty-chip-setup", "nifty-chip-intel", "nifty-chip-gamma"]) {
      expect(screen.getByTestId(id).style.flex, id).toBe("1 1 0%");
      expect(screen.getByTestId(id).style.height, id).toBe("100%");
    }
  });

  test("(c) every value node is right-aligned and every label left", () => {
    mount();
    const strip = screen.getByTestId("nifty-stat-strip");

    for (const value of Array.from(strip.querySelectorAll('[data-testid$="-value"]'))) {
      expect((value as HTMLElement).style.textAlign, value.getAttribute("data-testid") ?? "").toBe(
        "right",
      );
    }
    for (const label of Array.from(strip.querySelectorAll('[data-testid$="-label"]'))) {
      expect((label as HTMLElement).style.textAlign, label.getAttribute("data-testid") ?? "").toBe(
        "left",
      );
    }
    // Cell labels are the first span of every stat cell; chips inline them too.
    for (const cellId of [
      "nifty-stat-spot",
      "nifty-stat-regime",
      "nifty-stat-flip",
      "nifty-stat-call-wall",
      "nifty-stat-put-wall",
      "nifty-stat-pin",
      "nifty-stat-max-pain",
      "nifty-stat-pcr-oi",
      "nifty-stat-pcr-vol",
      "nifty-chip-setup",
      "nifty-chip-intel",
      "nifty-chip-gamma",
    ]) {
      const cell = screen.getByTestId(cellId);
      const label = cell.children[0] as HTMLElement;
      const value = cell.children[cell.children.length - 1] as HTMLElement;
      expect(label.style.textAlign, `${cellId} label`).toBe("left");
      expect(value.style.textAlign, `${cellId} value`).toBe("right");
    }
  });

  test("(d) no value is below the body step; the value step is the primary numeric read", () => {
    mount();
    const strip = screen.getByTestId("nifty-stat-strip");
    const valueNodes = Array.from(strip.querySelectorAll('[data-testid$="-value"]')) as HTMLElement[];
    const sizes = valueNodes.map((el) => Number.parseFloat(el.style.fontSize));
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(REPORT_FONT.body);

    const spot = screen.getByTestId("nifty-stat-spot-value");
    expect(spot.style.fontSize).toBe(`${REPORT_FONT.value}px`);
    // The value step is reserved for the three primary numeric reads.
    const promoted = valueNodes
      .filter((el) => Number.parseFloat(el.style.fontSize) === REPORT_FONT.value)
      .map((el) => el.getAttribute("data-testid"));
    expect(promoted).toEqual([
      "nifty-stat-spot-value",
      "nifty-stat-call-wall-value",
      "nifty-stat-max-pain-value",
    ]);

    // Chips render their values as the last inline span, without a -value id.
    for (const id of ["nifty-chip-setup", "nifty-chip-intel", "nifty-chip-gamma"]) {
      const chip = screen.getByTestId(id);
      const value = chip.children[chip.children.length - 1] as HTMLElement;
      expect(Number.parseFloat(value.style.fontSize), id).toBeGreaterThanOrEqual(
        REPORT_FONT.body,
      );
    }
  });

  test("(e) all pre-existing cell testids survive the regroup", () => {
    mount();
    for (const id of [
      "nifty-stat-strip",
      "nifty-decision-stats",
      "nifty-context-stats",
      "nifty-stat-spot",
      "nifty-stat-spot-value",
      "nifty-stat-regime",
      "nifty-stat-regime-value",
      "nifty-stat-flip",
      "nifty-stat-flip-value",
      "nifty-stat-call-wall",
      "nifty-stat-call-wall-value",
      "nifty-stat-put-wall",
      "nifty-stat-put-wall-value",
      "nifty-stat-pin",
      "nifty-stat-pin-value",
      "nifty-stat-pcr-oi",
      "nifty-stat-pcr-vol",
      "nifty-stat-max-pain",
      "nifty-pcr-spark",
      "nifty-maxpain-spark",
      "nifty-chip-setup",
      "nifty-chip-intel",
      "nifty-chip-gamma",
      "nifty-verdict-wrap",
      "nifty-verdict-strip",
      "nifty-plan-oneliner",
      "nifty-plan-headline",
      "nifty-plan-confidence",
      "nifty-plan-reasons-button",
    ]) {
      expect(screen.getByTestId(id), id).toBeInTheDocument();
    }
  });
});

describe("decision strip — readout width and no-inline-ellipsis contract", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/pages/report/ReportDecisionStrip.groups.tsx"),
    "utf8",
  );

  test("the max-pain cell and FLOW group render the derived floors as min-widths", () => {
    mount();
    expect(screen.getByTestId("nifty-stat-max-pain").style.minWidth).toBe(
      `${REPORT_STRIP_CELL_MIN.maxPain}px`,
    );
    expect(screen.getByTestId("nifty-stat-group-walls").style.minWidth).toBe(
      `${REPORT_STRIP_GROUP_WEIGHT.walls}px`,
    );
    // The FLOW group no longer contributes its summed weight to the desktop
    // grid's min-content width; its floor is the widest single chip instead.
    const flow = screen.getByTestId("nifty-stat-group-flow");
    expect(flow.style.minWidth).toBe(`${REPORT_STRIP_CELL_MIN.chipGamma}px`);
    expect(flow.style.flex).toBe("1 0 100%");
    expect(REPORT_STRIP_GROUP_WEIGHT.flow).toBe(
      REPORT_STRIP_CELL_MIN.chipSetup +
        REPORT_STRIP_CELL_MIN.chipIntel +
        REPORT_STRIP_CELL_MIN.chipGamma,
    );
  });

  test("the FLOW chip row wraps and cannot grow past the 1600-safe width", () => {
    mount();
    const cells = screen.getByTestId("nifty-stat-group-flow-cells");
    expect(cells.className).toMatch(/(^|\s)flex-wrap(\s|$)/);
    expect(cells.style.maxWidth).toBe(`${FLOW_CELLS_MAX_WIDTH}px`);
    // 700px clears the measured 13px readout requirement of all three chips.
    expect(FLOW_CELLS_MAX_WIDTH).toBeGreaterThanOrEqual(
      REPORT_STRIP_GROUP_WEIGHT.flow + 3 * 16,
    );
  });

  test("max-pain value carries an inline MAX PAIN label before the sparkline", () => {
    mount();
    const value = screen.getByTestId("nifty-stat-max-pain-value");
    const label = screen.getByTestId("nifty-maxpain-inline-label");
    const spark = screen.getByTestId("nifty-maxpain-spark");
    const pin = screen.getByTestId("nifty-stat-pin");

    expect(label).toHaveTextContent("MAX PAIN");
    expect(label.style.textAlign).toBe("left");
    expect(label.style.textOverflow || "").not.toBe("ellipsis");
    expect(label.style.overflow || "").not.toBe("hidden");
    // The 8px gutter is spent the same way as the group hairline: 4px gap +
    // 1px rule + 3px inset, so the bare number no longer reads as part of
    // the PIN RISK value to its left.
    expect(label.style.marginLeft).toBe(`${REPORT_STRIP_METRICS.cellGap}px`);
    expect(label.style.borderLeftWidth).toBe(`${REPORT_STRIP_METRICS.groupHairline}px`);
    expect(label.style.paddingLeft).toBe(`${REPORT_STRIP_METRICS.groupInset}px`);
    expect(label.style.marginRight).toBe(`${REPORT_STRIP_METRICS.cellGap}px`);
    expect(pin.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const text = value.textContent ?? "";
    expect(text.indexOf("MAX PAIN")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("MAX PAIN")).toBeLessThan(text.indexOf("25,000"));
    const children = Array.from(value.children) as HTMLElement[];
    const labelIndex = children.indexOf(label as HTMLElement);
    const sparkIndex = children.indexOf(spark as HTMLElement);
    expect(labelIndex).toBeGreaterThanOrEqual(0);
    expect(sparkIndex).toBeGreaterThan(labelIndex);
    expect(sparkIndex).toBe(children.length - 1);
  });

  test("missing max pain prints a dash without an orphan inline label", () => {
    const baseReport = h.store.data.report;
    h.store.data.report = () => ({ ...baseReport(), maxPain: null });
    const { unmount } = mount();
    expect(screen.getByTestId("nifty-stat-max-pain-value")).toHaveTextContent("—");
    expect(screen.queryByTestId("nifty-maxpain-inline-label")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-maxpain-spark")).not.toBeInTheDocument();
    unmount();
    h.store.data.report = baseReport;
  });

  test("a loading report renders no walls cells", () => {
    const baseReport = h.store.data.report;
    h.store.data.report = () => undefined as unknown as ReturnType<typeof baseReport>;
    const { unmount } = mount();
    expect(screen.queryByTestId("nifty-stat-group-walls")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-maxpain-inline-label")).not.toBeInTheDocument();
    unmount();
    h.store.data.report = baseReport;
  });

  test("the max-pain readout is neither ellipsized nor shrunk inline", () => {
    const start = source.indexOf('testId="nifty-stat-max-pain"');
    const cell = source.slice(start, source.indexOf('testId="nifty-stat-pcr-oi"', start));
    expect(cell).toContain("valueSize={REPORT_FONT.value}");
    expect(cell).not.toMatch(/text-overflow|textOverflow|overflow:\s*["']hidden/);
    expect(cell).not.toMatch(/font-size/);
  });

  test("the FLOW label and its chip keep the full text in title and aria", () => {
    mount();
    const label = screen.getByTestId("nifty-stat-group-flow-label");
    expect(label.getAttribute("title")).toBe("FLOW & ACTION");
    expect(label.style.textOverflow || "").not.toBe("ellipsis");
    for (const [id, text] of [
      ["nifty-chip-setup", "Setup checks"],
      ["nifty-chip-intel", "Institutional flows"],
      ["nifty-chip-gamma", "Dealer gamma"],
    ] as const) {
      const chip = screen.getByTestId(id);
      expect(chip).toHaveTextContent(text);
      expect(chip.getAttribute("title")).toContain(text);
      expect(chip.getAttribute("aria-label")).toContain(text);
    }
  });
});
