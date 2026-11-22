// @vitest-environment node
/**
 * Whole-surface typography-floor guard for the Index Report page.
 *
 * The two earlier guards each own a hand-maintained file list. This one walks
 * the report directory so a new file — or a file that was outside an earlier
 * lane's scope — cannot reintroduce sub-11px text unnoticed. SVG attributes,
 * Tailwind arbitrary values and inline styles all count.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REPORT_FONT } from "./reportTokens";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FLOOR = 11;

const SOURCE_FILES = readdirSync(HERE)
  .filter((name) => /\.(ts|tsx)$/.test(name) && !name.includes(".test."))
  .sort();

const FONT_SIZE =
  /text-\[(\d+(?:\.\d+)?)px\]|["']?font-size["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)px|\bfontSize\s*[:=]\s*["']?(\d+(?:\.\d+)?)|\bfont-size="(\d+(?:\.\d+)?)"/g;

function belowFloor(file: string): string[] {
  return readFileSync(`${HERE}${file}`, "utf8")
    .split("\n")
    .flatMap((line, i) => {
      const px = [...line.matchAll(FONT_SIZE)]
        .map((m) => Number(m[1] ?? m[2] ?? m[3] ?? m[4]))
        .filter((n) => n < FLOOR);
      return px.map((n) => `${file}:${i + 1} (${n}px)`);
    });
}

describe("report surface typography floor (all files)", () => {
  it("scans the whole report surface, not a hand-maintained subset", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(20);
    expect(SOURCE_FILES).toContain("NiftyWallMigration.tsx");
    expect(SOURCE_FILES).toContain("NiftyVolumeProfile.tsx");
    expect(SOURCE_FILES).toContain("ReportWorkspace.tsx");
  });

  it("REPORT_FONT.micro is the 11px floor", () => {
    expect(REPORT_FONT.micro).toBe(FLOOR);
  });

  it("no literal font size below 11px in any report source file", () => {
    const offenders = SOURCE_FILES.flatMap(belowFloor);
    expect(offenders, `\n${offenders.join("\n")}`).toEqual([]);
  });
});
