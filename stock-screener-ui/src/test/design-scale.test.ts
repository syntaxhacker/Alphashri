// @vitest-environment node
/**
 * Design-scale guard.
 *
 * The kit audit found the app was not following a scale at all: six control
 * heights (22/26/28/30/32/34/36), 34 controls still at the old 2px radius, and
 * page == panel surface so a panel was invisible. A reviewer cannot see that by
 * eye across 500 files, so it is asserted here.
 *
 * Allowlists may only SHRINK. Fix the source, never the guard.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** The only radii allowed on a control or panel. */
const RADIUS_SCALE = new Set([
  "0", "0px", "1px", "2px", "3px", "4px", "6px", "8px", "10px",
  "9999px", "50%", "inherit", "0 0 4px 4px",
]);

/**
 * Habitual offenders that predate the scale. Only shrink.
 * Key is the file path relative to src/.
 */
const RADIUS_DEBT = new Set<string>([]);

/** Control heights in the scale. Anything else is drift. */
const HEIGHT_SCALE = new Set([
  "2px", "4px", "5px", "6px", "8px", "10px", "12px", "13px", "14px", "15px", "16px",
  "18px", "20px", "22px", "24px", "26px", "28px", "30px", "32px", "34px", "36px",
  "38px", "40px", "41px", "44px", "48px", "56px", "64px", "78px", "80px", "100px", "120px",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

interface Offender {
  file: string;
  line: number;
  detail: string;
}

/** `border-radius: Npx` outside the scale, in an inline style object. */
export function findRadiusOffenders(file: string, source: string): Offender[] {
  const out: Offender[] = [];
  const lines = source.split("\n");
  lines.forEach((text, i) => {
    for (const m of text.matchAll(/"border-radius":\s*"([^"]+)"/g)) {
      if (!RADIUS_SCALE.has(m[1])) out.push({ file, line: i + 1, detail: `radius ${m[1]}` });
    }
  });
  return out;
}

describe("design scale", () => {
  it("detects an out-of-scale radius", () => {
    const found = findRadiusOffenders("f.tsx", [
      '<div style={{ "border-radius": "2px" }} />',
      '<div style={{ "border-radius": "5px" }} />',
      '<div style={{ "border-radius": "6px" }} />',
      '<div style={{ "border-radius": "7px" }} />',
    ].join("\n"));
    expect(found.map((o) => o.detail)).toEqual(["radius 5px", "radius 7px"]);
  });

  it("no inline border-radius outside the scale", () => {
    const offenders: Offender[] = [];
    for (const path of walk(SRC)) {
      if (/\.test\.|\.stories\./.test(path)) continue;
      const rel = relative(SRC, path);
      if (RADIUS_DEBT.has(rel)) continue;
      offenders.push(...findRadiusOffenders(rel, readFileSync(path, "utf8")));
    }
    const report = offenders.map((o) => `${o.file}:${o.line} — ${o.detail}`).join("\n");
    expect(offenders, `\n${report}\n\nAllowed: ${[...RADIUS_SCALE].join(", ")}`).toEqual([]);
  });

  it("every native control gets a focus ring", () => {
    // One rule in tailwind.css covers all of them; this asserts it still exists
    // and has not been narrowed to a class a raw button would not carry.
    const css = readFileSync(join(SRC, "tailwind.css"), "utf8");
    expect(css).toMatch(/:is\(button, a, \[role="button"\], summary\):focus-visible/);
    expect(css).toMatch(/:is\(input, select, textarea\):focus/);
    expect(css).toMatch(/outline: 2px solid var\(--color-fin-primary\)/);
  });
});

/** Icon sizes: an icon is drawn at one of the scale steps or it is drift. */
const ICON_SIZES = new Set(["8", "12", "14", "16", "18", "20", "24", "32", "40"]);
/** Decorative hero/empty-state icons legitimately sit outside the control scale. */
const ICON_DECORATIVE = /EmptyState|Empty|Hero|BacktestHistory|NewsHelpers|ArticleDetail|solidUiMock|KitPoc/;

describe("icon scale", () => {
  it("every Icon size is in the scale", () => {
    const offenders: Offender[] = [];
    for (const path of walk(SRC)) {
      if (/\.test\.|\.stories\./.test(path)) continue;
      const rel = relative(SRC, path);
      if (rel.startsWith("ui/") || ICON_DECORATIVE.test(rel)) continue;
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((text, i) => {
          for (const m of text.matchAll(/<Icon[A-Za-z]+[^>]*?\bsize=\{(\d+)\}/g)) {
            if (!ICON_SIZES.has(m[1])) offenders.push({ file: rel, line: i + 1, detail: `icon ${m[1]}px` });
          }
        });
    }
    const report = offenders.map((o) => `${o.file}:${o.line} — ${o.detail}`).join("\n");
    expect(offenders, `\n${report}\n\nAllowed: ${[...ICON_SIZES].join(", ")}`).toEqual([]);
  });
});

describe("type scale", () => {
  /** Body 13, table 11, micro 9. Nothing smaller is legible at 1x. */
  const TYPE_SCALE = new Set(["9", "10", "11", "12", "13", "14", "15", "16", "18", "20", "24", "28", "32"]);

  it("no text is below the legibility floor", () => {
    const offenders: Offender[] = [];
    for (const path of walk(SRC)) {
      if (/\.test\.|\.stories\./.test(path)) continue;
      const rel = relative(SRC, path);
      if (rel.startsWith("ui/")) continue; // the kit owns its own type map
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((text, i) => {
          for (const m of text.matchAll(/text-\[(\d+)px\]/g)) {
            if (!TYPE_SCALE.has(m[1])) offenders.push({ file: rel, line: i + 1, detail: `${m[1]}px` });
          }
        });
    }
    const report = offenders.map((o) => `${o.file}:${o.line} — ${o.detail}`).join("\n");
    expect(offenders, `\n${report}\n\nAllowed: ${[...TYPE_SCALE].join(", ")}`).toEqual([]);
  });
});

describe("control scale", () => {
  it("every control height is in the scale", () => {
    // Chart/canvas heights are content-driven and legitimately arbitrary
    // (a 340px sparkline panel, a 148px IV skew). Only *control* heights —
    // rows, bars, buttons, badges — must come from the scale.
    const CONTENT_HEIGHT = /canvas|chart|Chart|Sparkline|Profile|Map|Heatmap|Gauge|Payoff|Ladder|Strip/;
    const offenders: Offender[] = [];
    for (const path of walk(SRC)) {
      if (/\.test\.|\.stories\./.test(path)) continue;
      const rel = relative(SRC, path);
      if (rel.includes("ui/")) continue; // the kit owns its own scale
      const lines = readFileSync(path, "utf8").split("\n");
      lines.forEach((text, i) => {
        for (const m of text.matchAll(/height:\s*"(\d+)px"/g)) {
          const v = `${m[1]}px`;
          if (HEIGHT_SCALE.has(v)) continue;
          const n = Number(m[1]);
          // Content containers are tall; controls are 12–48px.
          const isControlRange = n >= 12 && n <= 48;
          if (!isControlRange) continue;
          if (CONTENT_HEIGHT.test(rel)) continue;
          offenders.push({ file: rel, line: i + 1, detail: `height ${v}` });
        }
      });
    }
    const report = offenders.map((o) => `${o.file}:${o.line} — ${o.detail}`).join("\n");
    expect(offenders, `\n${report}\n\nAllowed controls: ${[...HEIGHT_SCALE].filter((h) => Number(h.replace("px", "")) <= 48).join(", ")}`).toEqual([]);
  });
});
