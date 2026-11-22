// @vitest-environment node
/**
 * Typography-floor guard for the report label/strip lane.
 *
 * The desktop audit found ~57 text nodes below the 11px floor across these
 * files — including canvas labels inside ECharts config objects. A literal
 * under the floor is a legibility bug, not a style choice: 9px terminal text
 * reads as a debug page at 1920px. Keep every declaration at or above 11px.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REPORT_FONT } from "./reportTokens";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FLOOR = 11;

const GUARDED_FILES = [
  "NiftyPressureDesk.tsx",
  "NiftyGammaStrip.tsx",
  "NiftyFlowStrip.tsx",
  "NiftyDepthMap.tsx",
  "ReportOverlays.tsx",
  "NiftyPositionsDrawer.tsx",
  "ReportStrips.tsx",
  "NiftyGexProfile.tsx",
  "ReportAnalytics.tsx",
  "ReportLeaderStrip.tsx",
  "IndexMoversModal.tsx",
  "LocalPanelModal.tsx",
  "NiftyDeskGuide.tsx",
  "NiftyDeltaPositioning.tsx",
] as const;

const FONT_SIZE =
  /text-\[(\d+(?:\.\d+)?)px\]|["']?font-size["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)px|\bfontSize\s*[:=]\s*["']?(\d+(?:\.\d+)?)|\bfont-size="(\d+(?:\.\d+)?)"/g;

function belowFloor(file: string): string[] {
  return readFileSync(`${HERE}${file}`, "utf8")
    .split("\n")
    .flatMap((line, i) => {
      const hits = [...line.matchAll(FONT_SIZE)]
        .map((m) => Number(m[1] ?? m[2] ?? m[3] ?? m[4]))
        .filter((px) => px < FLOOR)
        .map((px) => `${file}:${i + 1} (${px}px)`);
      const derived = /REPORT_FONT\.\w+\s*-\s*\d+/.test(line)
        ? [`${file}:${i + 1} (derived sub-floor size)`]
        : [];
      return [...hits, ...derived];
    });
}

describe("report label/strip lane typography floor", () => {
  it("REPORT_FONT.micro is the 11px floor", () => {
    expect(REPORT_FONT.micro).toBe(FLOOR);
  });

  it("no font size below 11px in the label/strip lane files", () => {
    const offenders = GUARDED_FILES.flatMap(belowFloor);
    expect(offenders, `\n${offenders.join("\n")}`).toEqual([]);
  });
});
