// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const dir = resolve(process.cwd(), "src/pages/report");
const source = (name: string) => readFileSync(resolve(dir, name), "utf8");
const lines = (name: string) => source(name).split("\n").length;

const FACADE = "NiftyDepthMap.tsx";
const LINE_BUDGET = 400;

const MODULES: Record<string, string> = {
  "NiftyDepthMap.format.ts": "export function formatOiCompact",
  "NiftyDepthMap.geometry.ts": "export function buildDepthRows",
  "NiftyDepthMap.bars.ts": "export function peBarSeries",
  "NiftyDepthMap.option.ts": "export function buildDepthOption",
  "NiftyDepthMap.header.ts": "export function depthLegendData",
};

const MODULE_NAMES = Object.keys(MODULES);

const PUBLIC_EXPORTS = [
  "NiftyDepthMap",
  "DEPTH_WINDOW",
  "DEPTH_MAX_ROWS",
  "formatOiCompact",
  "formatIstTimeMs",
  "buildDepthRows",
  "findOiPoc",
  "dayStats",
  "candleEpochMs",
  "topOiLabelStrikes",
  "levelLines",
  "buildDepthOption",
];

describe("NiftyDepthMap decomposition", () => {
  test("every section stays under the line budget", () => {
    for (const file of [FACADE, ...MODULE_NAMES]) {
      expect(lines(file), `${file} grew past ${LINE_BUDGET} lines`).toBeLessThan(LINE_BUDGET);
    }
  });

  test("facade keeps every stable public export", () => {
    const exportBlocks = [...source(FACADE).matchAll(/export\s*\{([^}]*)\}/g)]
      .map((m) => m[1])
      .join("\n");
    for (const symbol of PUBLIC_EXPORTS.filter((s) => s !== "NiftyDepthMap")) {
      expect(exportBlocks, `facade lost re-export ${symbol}`).toContain(symbol);
    }
    expect(source(FACADE)).toContain("export const NiftyDepthMap = NiftyDepthMapInner");
  });

  test("each module keeps its stated responsibility", () => {
    for (const [module, snippet] of Object.entries(MODULES)) {
      expect(source(module), `${module} lost its responsibility`).toContain(snippet);
    }
  });

  test("facade delegates instead of re-inlining chart or scale work", () => {
    const facade = source(FACADE);
    for (const module of ["format", "geometry", "option", "header"]) {
      expect(facade, `facade no longer imports ${module}`).toContain(`from "./NiftyDepthMap.${module}"`);
    }
    for (const inlined of [
      'type: "candlestick"',
      'name: "CE OI"',
      "gridIndex: 1",
      'barCategoryGap: "45%"',
      "candleYRange(",
      "const chgByStrike = new Map",
    ]) {
      expect(facade, `facade re-inlined ${inlined}`).not.toContain(inlined);
    }
    const option = source("NiftyDepthMap.option.ts");
    expect(option).toContain('from "./NiftyDepthMap.bars"');
    for (const builder of ["candleSeries", "ceBarSeries", "peBarSeries", "dominanceSeries", "depthTooltip"]) {
      expect(option, `option no longer delegates to ${builder}`).toContain(builder);
    }
  });

  test("pure helpers stay pure (no component/effect work outside the facade)", () => {
    for (const module of MODULE_NAMES) {
      const text = source(module);
      expect(text, `${module} took over rendering`).not.toContain('data-testid="nifty-');
      expect(text, `${module} took over effects`).not.toContain("createEffect(");
    }
    expect(source("NiftyDepthMap.geometry.ts")).not.toContain("export const NiftyDepthMap");
    expect(source("NiftyDepthMap.header.ts")).not.toContain("export const NiftyDepthMap");
  });

  test("every testid, label and unit label survives the split", () => {
    const all = [FACADE, ...MODULE_NAMES].map(source).join("\n");
    for (const token of [
      'data-testid="nifty-depthmap"',
      'data-testid="nifty-depth-stats"',
      'data-testid="nifty-depth-stat-last"',
      'data-testid="nifty-depth-stat-hilo"',
      'data-testid="nifty-depth-stat-chg"',
      'data-testid="nifty-depth-stat-pcr"',
      'data-testid="nifty-depth-stat-maxpain"',
      'data-testid="nifty-depth-legend"',
      'testId="nifty-depth-legend-ce-dom"',
      'testId="nifty-depth-legend-pe-dom"',
      'testId="nifty-depth-legend-total"',
      'testId="nifty-depth-legend-poc"',
      'testId="nifty-depth-legend-chg"',
      'data-testid="nifty-depth-chart"',
      'data-testid="nifty-depth-empty"',
      'data-testid="nifty-depth-echarts"',
      'data-testid="nifty-depth-note"',
      'label="Last"',
      'label="Hi / Lo"',
      'label="Change"',
      'label="PCR-OI"',
      'label="Max Pain"',
      'label="CE over PE"',
      'label="PE over CE"',
      'label="Total OI"',
      'label="OI POC"',
      'label="OI Chg"',
      'label="Depth map"',
      "No strikes in window",
      "No option-chain strikes near spot for this expiry.",
      "Strike OI from the chain snapshot — no tick footprint or GEX feed.",
      "OI Chg ${",
      "CE OI ${formatOiCompact",
      "PE OI ${formatOiCompact",
      "Total ${formatOiCompact",
      '"Nifty 15m"',
      '"CE OI"',
      '"PE OI"',
      '"CE over PE"',
      '"PE over CE"',
      "lakh: 1",
      "thousands: true",
      "grouped: false",
      "toFixed(2)",
    ]) {
      expect(all, `lost contract: ${token}`).toContain(token);
    }
  });

  test("level tags keep their names and placement priority", () => {
    const geometry = source("NiftyDepthMap.geometry.ts");
    for (const token of [
      "Spot ${fmtStrike(spot)}",
      "MP ${fmtStrike(Number(report.maxPain))}",
      "OI POC ${fmtStrike(poc)}",
      "Hi ${fmtStrike(stats.hi)}",
      "Lo ${fmtStrike(stats.lo)}",
      "LEVEL_DEDUPE_PTS = 25",
      "CANDLE_PAD_PCT = 0.0015",
      "DEPTH_WINDOW = 750",
      "DEPTH_MAX_ROWS = 31",
    ]) {
      expect(geometry, `lost level/scale contract: ${token}`).toContain(token);
    }
  });

  test("the 12px floor / 13px body hierarchy stays token-driven", () => {
    const bars = source("NiftyDepthMap.bars.ts");
    const option = source("NiftyDepthMap.option.ts");
    const facade = source(FACADE);
    expect(bars).toContain("${REPORT_FONT.micro}px");
    expect(option).toContain("${REPORT_FONT.micro}px");
    expect(facade).toContain('size="xs"');
    expect(facade).toContain('valueSize="md"');
    const all = [FACADE, ...MODULE_NAMES].map(source).join("\n");
    const subFloor = [...all.matchAll(/["']?font-size["']?\s*:\s*["']?(\d+(?:\.\d+)?)px/g)]
      .map((m) => Number(m[1]))
      .filter((px) => px < 12);
    expect(subFloor, "a literal font size below the 12px floor survived the split").toEqual([]);
  });
});
