// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const dir = resolve(process.cwd(), "src/pages/report");
const source = (name: string) => readFileSync(resolve(dir, name), "utf8");
const lines = (name: string) => source(name).split("\n").length;

const FACADE = "NiftyGexProfile.tsx";
const LINE_BUDGET = 400;

const MODULES: Record<string, string> = {
  "NiftyGexProfile.format.ts": "export function formatGexCr(",
  "NiftyGexProfile.levels.ts": "export function gexProfileStats(",
  "NiftyGexProfile.geometry.ts": "export function buildGexChart(",
  "NiftyGexProfile.rows.tsx": "export function GexStatRow(",
  "NiftyGexProfile.legend.tsx": "export function GexLevelsLegend(",
};
const MODULE_NAMES = Object.keys(MODULES);

describe("NiftyGexProfile decomposition", () => {
  test("every section stays under the line budget", () => {
    for (const file of [FACADE, ...MODULE_NAMES]) {
      expect(lines(file), `${file} grew past ${LINE_BUDGET} lines`).toBeLessThan(LINE_BUDGET);
    }
  });

  test("facade keeps the stable public export", () => {
    expect(source(FACADE)).toContain("export function NiftyGexProfile(");
  });

  test("each module keeps its stated responsibility", () => {
    for (const [module, snippet] of Object.entries(MODULES)) {
      expect(source(module), `${module} lost its responsibility`).toContain(snippet);
    }
  });

  test("facade re-exports the public API and delegates to every module", () => {
    const facade = source(FACADE);
    for (const module of MODULE_NAMES) {
      expect(facade, `facade no longer imports ${module}`).toContain(
        `from "./${module.replace(/\.(ts|tsx)$/, "")}"`,
      );
    }
    for (const api of [
      "buildGexProfile", "gexCumAtSpot", "gexFlipAtSpot", "gexRegimeAtSpot",
      "gexSpotRelative", "selectGexBand", "trimGexProfile", "nearestStrikeIndex",
      "buildGexChart", "gexProfileStats", "gexSideLevels", "formatGexCr",
      "formatGexStrike", "gexTone", "gexLevelTone", "gexSideCopy",
      "GEX_LEVEL_MAX_DIST_PCT", "GEX_LEVEL_MIN_SHARE", "GexSideLevel",
    ]) {
      expect(facade, `facade dropped public export ${api}`).toContain(api);
    }
    // Markup testids now live in the row / legend modules, not the facade.
    for (const inlined of [
      'testId="nifty-gex-profile-net"',
      'data-testid="nifty-gex-profile-regime"',
      'data-testid="nifty-gex-profile-levels-legend"',
      'data-testid="nifty-gex-profile-caption"',
    ]) {
      expect(facade, `facade re-inlined ${inlined}`).not.toContain(inlined);
    }
  });

  test("every testid, unit and copy marker survives the split", () => {
    const all = [FACADE, ...MODULE_NAMES].map(source).join("\n");
    for (const token of [
      'testId="nifty-gex-profile-panel"',
      'testId="nifty-gex-profile-net"',
      'testId="nifty-gex-profile-zero"',
      'testId="nifty-gex-profile-support"',
      'testId="nifty-gex-profile-resist"',
      'data-testid="nifty-gex-profile-regime"',
      'data-testid="nifty-gex-profile-coverage"',
      'testId="nifty-gex-profile-chart"',
      'data-testid="nifty-gex-profile-levels-legend"',
      'data-testid="nifty-gex-profile-level-legend-sup"',
      'data-testid="nifty-gex-profile-level-legend-res"',
      'data-testid="nifty-gex-profile-caption"',
      "No per-strike GEX profile",
      "GEX profile",
      "Cr/pt",
      "Σ all strikes",
      "zero γ",
      "pin magnet · below",
      "pin magnet · above",
      "γ fuel ↓",
      "γ fuel ↑",
      "strikes carry ≥${",
      "Dealers hold long gamma",
      "Dealers are short gamma",
      "SUP · support",
      "RES · resistance",
      "SPOT / ZERO mark today's spot",
      "x: strike · y: net γ (₹ Cr/pt, √ scale)",
      'scale="sqrt"',
      "height={120}",
    ]) {
      expect(all, `lost contract: ${token}`).toContain(token);
    }
    expect(source("NiftyGexProfile.rows.tsx")).toContain("testId=\"nifty-gex-profile-net\"");
    expect(source("NiftyGexProfile.legend.tsx")).toContain(
      'data-testid="nifty-gex-profile-levels-legend"',
    );
  });

  test("the 12px / 13px hierarchy and chart geometry stay token-driven", () => {
    for (const module of ["NiftyGexProfile.rows.tsx", "NiftyGexProfile.legend.tsx"]) {
      expect(source(module)).toContain('"font-size": `${REPORT_FONT.micro}px`');
    }
    const legend = source("NiftyGexProfile.legend.tsx");
    expect(legend.match(/size="xs"/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source(FACADE)).toContain("${REPORT_RADIUS.md}px");
    expect(source("NiftyGexProfile.geometry.ts")).toContain("GEX_SIGNIFICANCE_SHARE = 0.01");
  });
});
