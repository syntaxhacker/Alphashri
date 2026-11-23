import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const dir = resolve(process.cwd(), "src/pages/report");
const source = (name: string) => readFileSync(resolve(dir, name), "utf8");
const lines = (name: string) => source(name).split("\n").length;

const FACADE = "niftyReportStore.ts";
const MODULES = [
  "niftyReportStore.types.ts",
  "niftyReportStore.helpers.ts",
  "niftyReportStore.state.ts",
  "niftyReportStore.derived.ts",
  "niftyReportStore.reportHandlers.ts",
  "niftyReportStore.uiHandlers.ts",
  "niftyReportStore.effectsCore.ts",
  "niftyReportStore.effectsReplay.ts",
  "niftyReportStore.factory.ts",
] as const;

const REQUIRED_VALUE_EXPORTS = [
  "NIFTY_DESK_MODE_KEY",
  "NIFTY_CHART_SOURCE_KEY",
  "GENERIC_POLL_MS",
  "readChartSource",
  "persistChartSource",
  "createNiftyReportStore",
  "startNiftyReportEffects",
];

const REQUIRED_TYPE_EXPORTS = [
  "ChartSource",
  "ChartView",
  "DeskMode",
  "DeskOverlayKey",
  "HeatMetric",
  "NiftyReportAlerts",
  "NiftyReportData",
  "NiftyReportFreshness",
  "NiftyReportReplay",
  "NiftyReportSelection",
  "NiftyReportStore",
  "NiftyReportStoreOptions",
  "NiftyReportUi",
  "NiftyReportWalls",
  "ReportIndex",
  "ReportSymbol",
  "SideTab",
];

describe("niftyReportStore decomposition", () => {
  test("facade re-exports every public symbol", () => {
    const facade = source(FACADE);
    for (const symbol of REQUIRED_VALUE_EXPORTS) {
      expect(facade, `missing value re-export: ${symbol}`).toMatch(
        new RegExp(`\\b${symbol}\\b[\\s\\S]*?from "\\./niftyReportStore\\.`),
      );
    }
    const typeExportBlock = facade.match(/export type \{([\s\S]*?)\} from "\.\/niftyReportStore\.types"/);
    expect(typeExportBlock, "missing type re-export block").not.toBeNull();
    for (const symbol of REQUIRED_TYPE_EXPORTS) {
      expect(typeExportBlock?.[1], `missing type re-export: ${symbol}`).toMatch(
        new RegExp(`\\b${symbol}\\b`),
      );
    }
  });

  test("facade stays a facade", () => {
    const facade = source(FACADE);
    expect(lines(FACADE)).toBeLessThan(80);
    for (const implementation of [
      "createSignal",
      "createMemo",
      "createEffect",
      "buildNiftyReportStore",
    ]) {
      expect(facade).not.toContain(implementation);
    }
  });

  test("modules stay decomposed", () => {
    expect(lines(FACADE)).toBeLessThan(700);
    const expectedExports: Record<string, string> = {
      "niftyReportStore.types.ts": "export interface NiftyReportStore",
      "niftyReportStore.helpers.ts": "export function readChartSource",
      "niftyReportStore.state.ts": "export function createStoreState",
      "niftyReportStore.derived.ts": "export function createDerived",
      "niftyReportStore.reportHandlers.ts": "export function createReportHandlers",
      "niftyReportStore.uiHandlers.ts": "export function createUiHandlers",
      "niftyReportStore.effectsCore.ts": "export function createEffectsCore",
      "niftyReportStore.effectsReplay.ts": "export function createEffectsReplay",
      "niftyReportStore.factory.ts": "export function createNiftyReportStore",
    };
    for (const module of MODULES) {
      expect(lines(module), `${module} grew past the 700-line budget`).toBeLessThan(700);
      expect(source(module), `${module} lost its responsibility`).toContain(
        expectedExports[module],
      );
    }
  });

  test("facade and factory delegate to the implementation modules", () => {
    const facade = source(FACADE);
    for (const module of [
      "niftyReportStore.types",
      "niftyReportStore.helpers",
      "niftyReportStore.factory",
    ]) {
      expect(facade, `facade no longer imports ${module}`).toContain(`./${module}"`);
    }
    const factory = source("niftyReportStore.factory.ts");
    for (const module of [
      "niftyReportStore.state",
      "niftyReportStore.derived",
      "niftyReportStore.reportHandlers",
      "niftyReportStore.uiHandlers",
      "niftyReportStore.effectsCore",
      "niftyReportStore.effectsReplay",
    ]) {
      expect(factory, `factory no longer imports ${module}`).toContain(`./${module}"`);
    }
  });
});
