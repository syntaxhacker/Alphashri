// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { NEGATIVE, PRIMARY, TEXT_MUTED } from "@/ui/palette";
import type { WallsEvent, WallsPayload } from "@/api/reportNifty";
import {
  wallsBreakDetail,
  wallsBreakHeadline,
  wallsDteLabel,
  wallsEventLabel,
  wallsGapLabel,
  wallsReadText,
  wallsRebreakDetail,
  wallsStateColor,
  wallsStatCells,
} from "./NiftyWallsExpanded.format";

const dir = resolve(process.cwd(), "src/pages/report");
const source = (name: string) => readFileSync(resolve(dir, name), "utf8");
const lines = (name: string) => source(name).split("\n").length;

const FACADE = "NiftyWallsExpanded.tsx";
const MODULES = [
  "NiftyWallsExpanded.format.ts",
  "NiftyWallsExpanded.header.tsx",
  "NiftyWallsExpanded.statStrip.tsx",
  "NiftyWallsExpanded.sequences.tsx",
  "NiftyWallsExpanded.eventTable.tsx",
  "NiftyWallsExpanded.readout.tsx",
] as const;
const LINE_BUDGET = 450;

describe("NiftyWallsExpanded decomposition", () => {
  test("every module stays under the line budget", () => {
    expect(lines(FACADE), `${FACADE} grew past ${LINE_BUDGET} lines`).toBeLessThan(LINE_BUDGET);
    for (const module of MODULES) {
      expect(lines(module), `${module} grew past ${LINE_BUDGET} lines`).toBeLessThan(LINE_BUDGET);
    }
  });

  test("facade keeps the stable public export", () => {
    expect(source(FACADE)).toContain("export function NiftyWallsExpanded(");
  });

  test("each module keeps its stated responsibility", () => {
    const responsibilities: Record<string, string> = {
      "NiftyWallsExpanded.format.ts": "export function wallsStatCells(",
      "NiftyWallsExpanded.header.tsx": "export function WallsModalHeader(",
      "NiftyWallsExpanded.statStrip.tsx": "export function WallsStatStrip(",
      "NiftyWallsExpanded.sequences.tsx": "export function WallsLadder(",
      "NiftyWallsExpanded.eventTable.tsx": "export function WallsSequenceTable(",
      "NiftyWallsExpanded.readout.tsx": "export function WallsReadout(",
    };
    for (const module of MODULES) {
      expect(source(module), `${module} lost its responsibility`).toContain(responsibilities[module]);
    }
  });

  test("facade delegates to every module instead of re-inlining their markup", () => {
    const facade = source(FACADE);
    for (const module of MODULES.filter((name) => name.endsWith(".tsx"))) {
      expect(facade, `facade no longer imports ${module}`).toContain(
        `./${module.replace(/\.tsx$/, "")}"`,
      );
    }
    // Formatting is consumed by the JSX modules, not inlined into the facade.
    expect(source("NiftyWallsExpanded.statStrip.tsx")).toContain('from "./NiftyWallsExpanded.format"');
    expect(source("NiftyWallsExpanded.readout.tsx")).toContain('from "./NiftyWallsExpanded.format"');
    for (const testid of [
      'data-testid="walls-stat-scroll"',
      'data-testid="walls-ladder"',
      'data-testid="walls-events"',
      'data-testid="walls-read"',
      'data-testid="walls-break"',
    ]) {
      expect(facade, `facade re-inlined ${testid}`).not.toContain(testid);
    }
  });

  test("every expanded data-testid and scroll cue survives the split", () => {
    const all = MODULES.map((module) => source(module)).join("\n");
    for (const marker of [
      'data-testid="walls-stat-scroll"',
      'data-testid="walls-stat-scroll-cue"',
      'data-testid="walls-ladder"',
      "walls-ladder-${props.side.toLowerCase()}-${props.row.strike}",
      'data-testid="walls-history"',
      'testId="walls-call-spark"',
      'testId="walls-put-spark"',
      'testId="walls-maxpain-spark"',
      "walls-table-${props.side.toLowerCase()}",
      "walls-table-${props.side.toLowerCase()}-scroll",
      "walls-table-${props.side.toLowerCase()}-scroll-cue",
      'data-testid="walls-events"',
      'data-testid="walls-events-scroll"',
      'data-testid="walls-read"',
      'data-testid="walls-break"',
      'data-testid="walls-replay-break"',
      "scroll → for all seven stats",
      "scroll → for all seven columns",
    ]) {
      expect(all, `lost marker: ${marker}`).toContain(marker);
    }
    expect(source("NiftyWallsExpanded.statStrip.tsx")).toContain("min-[840px]:hidden");
    const tables = source("NiftyWallsExpanded.eventTable.tsx");
    expect(tables).toContain("min-[720px]:hidden");
    expect(tables.match(/min-\[720px\]:hidden/g)).toHaveLength(2);
    expect(all.match(/overflow-x-auto/g)?.length).toBeGreaterThanOrEqual(3);
  });

  test("the 12/13 hierarchy and 28px rows stay token-driven", () => {
    const tables = source("NiftyWallsExpanded.eventTable.tsx");
    expect(tables).toContain("const TABLE_CELL_PAD = `${REPORT_PAD.sm}px ${REPORT_PAD.md}px`;");
    expect(tables).toContain("const EXPANDED_ROW_H = REPORT_ROW.comfortable;");
    expect(tables).toContain('const TABLE_MIN_W = "min-w-[720px]";');
    expect(tables).toContain('"font-size": `${REPORT_FONT.micro}px`');
    expect(tables).toContain('"font-size": `${REPORT_FONT.sm}px`');
    const statStrip = source("NiftyWallsExpanded.statStrip.tsx");
    expect(statStrip).toContain('"font-size": `${REPORT_FONT.micro}px`');
    expect(statStrip).toContain('"font-size": `${REPORT_FONT.md}px`');
    const sequences = source("NiftyWallsExpanded.sequences.tsx");
    expect(sequences).toContain('"font-size": `${REPORT_FONT.sm}px`');
  });
});

const walls = {
  state: "BREAK",
  dte: 0,
  spot: 74096.12,
  max_pain: 73900,
  max_pain_drift: -120,
  atm: 74000,
  pin_distance_pts: -196,
  pin_distance_pct: -0.26,
  net_gex: -12.3,
  flip: 74200,
  gex_degraded: false,
  expiry_day: true,
  read: "",
  freshness: {
    last_t: "2026-10-23T14:25:48",
    age_sec: 12,
    stale: false,
    rows: 240,
    gaps: [],
  },
  alert: null,
  events: [],
} as unknown as WallsPayload;

const event = {
  at: "2026-10-23T14:25:48",
  kind: "BREAK",
  wall: 74000,
  spot: 74096.12,
  erosion_30m: -0.139,
  put_build_30m: 0.05,
  max_pain: 73900,
} as WallsEvent;

const alert = {
  ...event,
  symbol: "NIFTY",
  max_pain_drift: -0.0016,
  cooldown_min: 30,
  reasons: [],
} as NonNullable<WallsPayload["alert"]>;

describe("expanded walls formatting helpers", () => {
  test("stat cells keep the seven stats, their units and the PIN colour", () => {
    const cells = wallsStatCells(walls);
    expect(cells.map((cell) => cell.label)).toEqual([
      "SPOT", "MAX PAIN", "DRIFT", "ATM", "PIN", "GEX", "GEX FLIP",
    ]);
    expect(cells[0].value).toBe("74,096.12");
    expect(cells[2].value).toBe("-120");
    expect(cells[4]).toEqual({ label: "PIN", value: "-196 (-0.26%)", color: PRIMARY });
    expect(cells[5].value).toBe("-12.3");
    expect(wallsStatCells({ ...walls, gex_degraded: true }).slice(5)).toEqual([
      { label: "GEX", value: "n/a" },
      { label: "GEX FLIP", value: "n/a" },
    ]);
  });

  test("header labels and event labels keep the exact vocabulary", () => {
    expect(wallsStateColor(walls)).toBe(NEGATIVE);
    expect(wallsStateColor({ ...walls, state: "UNKNOWN" })).toBe(TEXT_MUTED);
    expect(wallsDteLabel(walls)).toBe("0-DTE");
    expect(wallsDteLabel({ ...walls, dte: 3 })).toBe("3-DTE");
    expect(wallsDteLabel({ ...walls, dte: null })).toBe("");
    expect(wallsEventLabel({ ...event, kind: "TOUCH" }, false)).toBe("TOUCH");
    expect(wallsEventLabel(event, true)).toBe("FIRST BREAK");
    expect(wallsEventLabel(event, false)).toBe("RE-BREAK");
  });

  test("break and freshness prose keeps the numbers and units", () => {
    expect(wallsBreakHeadline(null, event)).toBe("First break 74,000 · 74,096.1");
    expect(wallsBreakHeadline(walls.alert, event)).toBe("First break 74,000 · 74,096.1");
    expect(wallsBreakHeadline(alert, event)).toBe("74,000 gave way · 74,096.1");
    expect(wallsBreakDetail(event)).toBe("14:25:48 · call wall -13.9% · put build +5.0% · max pain 73,900");
    expect(wallsRebreakDetail(event)).toBe("Re-broke 14:25:48 · call -13.9% · put +5.0%");
    expect(wallsGapLabel(walls)).toBe("");
    expect(
      wallsGapLabel({
        ...walls,
        freshness: {
          ...walls.freshness,
          gaps: [{ from: "2026-10-23T14:04:00", to: "2026-10-23T14:20:00", seconds: 960 }],
        },
      }),
    ).toBe(" · last gap 14:04→14:20 (960s)");
  });

  test("read fallback keeps the 0-DTE and non-expiry prose", () => {
    expect(wallsReadText({ ...walls, read: "custom read" })).toBe("custom read");
    expect(wallsReadText(walls)).toMatch(/^0-DTE:/);
    expect(wallsReadText({ ...walls, expiry_day: false })).toMatch(/^Non-expiry:/);
  });
});
