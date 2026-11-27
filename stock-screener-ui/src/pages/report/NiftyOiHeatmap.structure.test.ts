// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { OI_CALL, OI_PUT, TEXT_MUTED } from "@/ui/palette";
import { cellFill, cellOpacity, formatWindowLabel } from "./NiftyOiHeatmap.format";
import { clockMinutes, computeFlipX, createHeatmapScale, strikeLabels } from "./NiftyOiHeatmap.geometry";

const dir = resolve(process.cwd(), "src/pages/report");
const source = (name: string) => readFileSync(resolve(dir, name), "utf8");
const lines = (name: string) => source(name).split("\n").length;

const FACADE = "NiftyOiHeatmap.tsx";
const MODULES = [
  "NiftyOiHeatmap.geometry.ts",
  "NiftyOiHeatmap.format.ts",
  "NiftyOiHeatmap.legend.tsx",
  "NiftyOiHeatmap.overlay.tsx",
] as const;
const LINE_BUDGET = 500;

describe("NiftyOiHeatmap decomposition", () => {
  test("every module stays under the line budget", () => {
    expect(lines(FACADE), `${FACADE} grew past ${LINE_BUDGET} lines`).toBeLessThan(LINE_BUDGET);
    for (const module of MODULES) {
      expect(lines(module), `${module} grew past ${LINE_BUDGET} lines`).toBeLessThan(LINE_BUDGET);
    }
  });

  test("facade keeps the stable public export", () => {
    const facade = source(FACADE);
    expect(facade).toContain("export function NiftyOiHeatmap(");
    const paletteExport = facade.match(/export \{([\s\S]*?)\} from "@\/ui\/palette"/);
    expect(paletteExport, "missing palette re-export block").not.toBeNull();
    for (const symbol of ["HEATMAP_CE", "HEATMAP_FLIP", "HEATMAP_MP", "HEATMAP_PE", "HEATMAP_SPOT"]) {
      expect(paletteExport?.[1], `missing re-export: ${symbol}`).toContain(symbol);
    }
  });

  test("each module keeps its stated responsibility", () => {
    const responsibilities: Record<string, string> = {
      "NiftyOiHeatmap.geometry.ts": "export function createHeatmapScale",
      "NiftyOiHeatmap.format.ts": "export function cellFill",
      "NiftyOiHeatmap.legend.tsx": "export function HeatmapLegend",
      "NiftyOiHeatmap.overlay.tsx": "export function HeatmapOverlay",
    };
    for (const module of MODULES) {
      expect(source(module), `${module} lost its responsibility`).toContain(responsibilities[module]);
    }
  });

  test("facade delegates to every module instead of re-inlining them", () => {
    const facade = source(FACADE);
    for (const module of MODULES) {
      expect(facade, `facade no longer imports ${module}`).toContain(`./${module.replace(/\.(ts|tsx)$/, "")}"`);
    }
    const overlay = source("NiftyOiHeatmap.overlay.tsx");
    expect(overlay).toContain("ctx.fillRect(");
    expect(overlay).toContain('data-testid="nifty-heatmap-spotline"');
    expect(source("NiftyOiHeatmap.legend.tsx")).toContain('data-testid="nifty-heatmap-legend"');
    expect(facade).not.toContain("ctx.fillRect(");
    expect(facade).not.toContain('data-testid="nifty-heatmap-spotline"');
    expect(facade).not.toContain('data-testid="nifty-heatmap-legend"');
  });
});

describe("decomposed heatmap helpers", () => {
  test("geometry keeps the exact viewBox mapping", () => {
    const scale = createHeatmapScale({
      vbW: 1000,
      vbH: 180,
      padL: 64,
      strikes: [100, 200, 300],
      cols: 4,
    });
    expect(scale.gridW).toBe(936);
    expect(scale.gridH).toBe(150);
    expect(scale.cellW).toBe(234);
    expect(scale.cellH).toBe(50);
    expect(scale.xOf(0)).toBe(181);
    expect(scale.xOf(3)).toBe(883);
    expect(scale.yOf(300)).toBe(0);
    expect(scale.yOf(100)).toBe(150);
    expect(scale.rowOf(200)).toBe(1);
  });

  test("axis helpers keep bare HH:MM parsing and the flow-flip guide", () => {
    expect(clockMinutes("09:15")).toBe(555);
    expect(clockMinutes("09:15:30")).toBeNull();
    const buckets = [{ startLabel: "09:15" }] as never;
    expect(computeFlipX("2026-10-23T09:25:00", buckets, 5, () => 181)).toEqual({
      x: 181,
      label: "09:25",
    });
    expect(computeFlipX("2026-10-23T09:05:00", buckets, 5, () => 181)).toBeNull();
    expect(strikeLabels([25600, 25700, 25800]).showAll).toBe(false);
    expect(strikeLabels([25650, 25750]).showAll).toBe(true);
  });

  test("formatting keeps cell colours, opacity floor and window labels", () => {
    expect(cellFill("ce")).toBe(OI_CALL);
    expect(cellFill("pe")).toBe(OI_PUT);
    expect(cellFill("flat")).toBe(TEXT_MUTED);
    expect(cellFill("other")).toBe("transparent");
    expect(cellOpacity("flat", 1)).toBe(0.14);
    expect(cellOpacity("ce", 0)).toBe(0.22);
    expect(cellOpacity("ce", 2)).toBe(1);
    expect(formatWindowLabel(2, 10)).toBe("±2 STRIKES");
    expect(formatWindowLabel(0, 1)).toBe("1 STRIKE");
  });
});
