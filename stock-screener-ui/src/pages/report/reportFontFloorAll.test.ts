// @vitest-environment happy-dom
/**
 * Whole-surface typography-floor guard for the Index Report page.
 *
 * Runs in happy-dom because REPORT_FONT now derives from `TYPE_SCALE` via the
 * `@/ui` barrel, which registers Solid DOM events when imported.
 *
 * The two earlier guards each own a hand-maintained file list. This one walks
 * the report directory so a new file — or a file that was outside an earlier
 * lane's scope — cannot reintroduce sub-floor text unnoticed. SVG attributes,
 * Tailwind arbitrary values and inline styles all count.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TYPE_SCALE } from "@/ui";
import { REPORT_FONT } from "./reportTokens";

const HERE = join(process.cwd(), "src/pages/report");
const FLOOR = REPORT_FONT.micro;
const SHARED_SCALE = Object.values(TYPE_SCALE).map((step) => step.size);

function sourceFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return sourceFiles(join(dir, entry.name), rel);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.") ? [rel] : [];
  });
}

const SOURCE_FILES = sourceFiles(HERE).sort();

const FONT_SIZE =
  /text-\[(\d+(?:\.\d+)?)px\]|["']?font-size["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)px|\bfontSize\s*[:=]\s*["']?(\d+(?:\.\d+)?)|\bfont-size="(\d+(?:\.\d+)?)"/g;

function literalSizes(file: string): string[] {
  return readFileSync(join(HERE, file), "utf8")
    .split("\n")
    .flatMap((line, i) =>
      [...line.matchAll(FONT_SIZE)].map((m) => `${file}:${i + 1} (${m[0]})`),
    );
}

function belowFloor(file: string): string[] {
  return readFileSync(join(HERE, file), "utf8")
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
    expect(SOURCE_FILES).toContain("sim/SimPayoff.tsx");
  });

  it("REPORT_FONT.micro is the 12px floor", () => {
    expect(REPORT_FONT.micro).toBe(FLOOR);
  });

  it("the report ladder is the shared 12/13/16/20/24 scale's 12/13/16/24 subset", () => {
    const values = Object.values(REPORT_FONT).filter(
      (value): value is number => typeof value === "number",
    );
    for (const px of values) expect(SHARED_SCALE, `${px}px`).toContain(px);
    expect([...new Set(values)].sort((a, b) => a - b)).toEqual([12, 13, 16, 24]);
    expect(REPORT_FONT.value).toBe(TYPE_SCALE.title.size);
    expect(REPORT_FONT.display).toBe(TYPE_SCALE.display.size);
  });

  it("no literal font size below the 12px floor in any report source file", () => {
    const offenders = SOURCE_FILES.flatMap(belowFloor);
    expect(offenders, `\n${offenders.join("\n")}`).toEqual([]);
  });

  it("no private font-size literal anywhere in report source", () => {
    const offenders = SOURCE_FILES.flatMap(literalSizes);
    expect(offenders, `\n${offenders.join("\n")}`).toEqual([]);
  });
});
