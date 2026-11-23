// @vitest-environment happy-dom
/**
 * Typography-floor guard for the Index Report surface.
 *
 * Runs in happy-dom because REPORT_FONT now derives from `TYPE_SCALE` via the
 * `@/ui` barrel, which registers Solid DOM events when imported.
 *
 * The audit found 91 sub-10px declarations on /report/index. The redesign
 * target is now the shared 12/13/16/24 scale (docs/INDEX_REPORT_REDESIGN.md),
 * with the report tokens derived from `TYPE_SCALE`. A literal that slips under
 * the floor — or off the shared scale — is a legibility bug, not a style
 * choice, including text drawn inside an SVG chart.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT_FONT } from "./reportTokens";

const HERE = join(process.cwd(), "src/pages/report");

const GUARDED_FILES = [
  "reportTokens.ts",
  "WallsMap.tsx",
  "NiftySqueezeRadar.tsx",
  "NiftyPressureLane.tsx",
  "NiftyIntelStrip.tsx",
  "NiftyFlowChart.tsx",
  "NiftyDeskPlan.tsx",
  "SetupRadarStrip.tsx",
  "reportCells.tsx",
  "reportBits.tsx",
  "NiftyWallsCard.tsx",
  "NiftyWallErosionBoard.tsx",
  "LevelsInPlay.tsx",
  "Nifty10sStrip.tsx",
  "IndexMoversStrip.tsx",
  "BreadthStrip.tsx",
] as const;

const FLOOR = REPORT_FONT.micro;

const FONT_SIZE =
  /text-\[(\d+(?:\.\d+)?)px\]|"font-size":\s*"(\d+(?:\.\d+)?)px"|fontSize:\s*(\d+(?:\.\d+)?)\b|font-size="(\d+(?:\.\d+)?)"/g;

function source(file: string): string {
  return readFileSync(join(HERE, file), "utf8");
}

function belowFloor(file: string): string[] {
  const out: string[] = [];
  source(file)
    .split("\n")
    .forEach((line, i) => {
      for (const match of line.matchAll(FONT_SIZE)) {
        const px = Number(match[1] ?? match[2] ?? match[3] ?? match[4]);
        if (px < FLOOR) out.push(`${file}:${i + 1} — ${match[0]} (${px}px)`);
      }
      if (/REPORT_FONT\.\w+\s*-\s*\d+/.test(line)) {
        out.push(`${file}:${i + 1} — derived sub-floor size (${line.trim()})`);
      }
    });
  return out;
}

describe("report typography floor", () => {
  it("REPORT_FONT.micro is the 12px floor and the scale is monotone", () => {
    expect(REPORT_FONT.micro).toBe(FLOOR);
    const steps = ["micro", "xs", "xsPlus", "sm", "md", "lg", "xl"] as const;
    const values = steps.map((step) => REPORT_FONT[step]);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
  });

  it("no font size below the 12px floor in the owned report files", () => {
    const offenders = GUARDED_FILES.flatMap(belowFloor);
    expect(offenders, `\n${offenders.join("\n")}`).toEqual([]);
  });
});
