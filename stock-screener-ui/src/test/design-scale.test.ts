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
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const UI = join(SRC, "ui");

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

  it("every native control gets a neutral, keyboard-only focus ring", () => {
    // One rule in tailwind.css must cover every native control (not a class a
    // raw element would lack), use :focus-visible only so a mouse click never
    // flashes chrome, and paint a neutral token rather than amber selection.
    const css = readFileSync(join(SRC, "tailwind.css"), "utf8");
    const rule = /:is\(([^)]+)\):focus-visible\s*\{([^}]*)\}/.exec(css);
    expect(rule, "no native-control :focus-visible rule in tailwind.css").toBeTruthy();
    const covered = rule![1].split(",").map((control) => control.trim());
    for (const control of ["button", "a", '[role="button"]', "summary", "input", "select", "textarea"]) {
      expect(covered, `${control} missing from the focus rule`).toContain(control);
    }
    expect(rule![2]).toMatch(/outline:\s*2px solid var\(--color-fin-text\)/);
    expect(rule![2]).toMatch(/outline-offset:\s*1px/);
    expect(rule![2], "focus ring must stay neutral").not.toMatch(/color-fin-(primary|warning)|#/);
    expect(css, "native controls must not use plain :focus").not.toMatch(/\):focus\s*\{/);

    const style = readFileSync(join(SRC, "style.css"), "utf8");
    const amberFocus = /:focus(?:-visible)?[^{]*\{[^}]*outline:[^;]*var\(--color-fin-primary\)/g;
    const offenders = [...css.matchAll(amberFocus), ...style.matchAll(amberFocus)].map((m) => m[0]);
    expect(offenders, `amber focus outlines: ${offenders.join(" | ")}`).toEqual([]);
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
      if (ICON_DECORATIVE.test(rel)) continue;
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

// One tier in src/ui/typography.ts. A private px declaration is drift even
// when its number happens to be in the ladder; use text-ui-* or typeStyle().
const PRIVATE_SIZE =
  /text-\[(\d+(?:\.\d+)?)(?:px|em)\]|"font-size"\s*:\s*"(\d+(?:\.\d+)?)(?:px|em)"|fontSize\s*:\s*(\d+(?:\.\d+)?)\b|font-size="(\d+(?:\.\d+)?)"/g;

/** rem literals and private alias ladders (the old sizeMap rem rungs). */
const PRIVATE_REM = [
  /text-\[(\d+(?:\.\d+)?)rem\]/g,
  /"font-size"\s*:\s*"(\d+(?:\.\d+)?)rem"/g,
  /font-size\s*=\s*"(\d+(?:\.\d+)?)rem"/g,
  /fontSize\s*:\s*"(\d+(?:\.\d+)?)rem"/g,
  /\b(?:xs|sm|md|lg|xl)\s*:\s*"(\d+(?:\.\d+)?)rem"/g,
];

/** A named size ladder indexed at the point of use (e.g. sizeMap[size]). */
const MAP_INDEX = /\b(?:sizeMap|SIZE_MAP|fontSizeMap|FONT_SIZE_MAP)\s*\[/g;

/** Computed font sizes are allowed only when sourced from the shared ladder. */
const COMPUTED_SIZE = [
  /"font-size"\s*:\s*`([^`]*)`/g,
  /"fontSize"\s*:\s*`([^`]*)`/g,
  /font-size\s*=\s*`([^`]*)`/g,
];
const SCALED = /\bTYPE_SCALE\b|\btypeSize\s*\(|\btypeStyle\s*\(|\bsnapTypeSize\s*\(/;

/**
 * `inDesignSystem` limits the new rem/computed checks to src/ui — the layer
 * that owns the aliases. The legacy px check stays repo-wide.
 */
export function findTypographyOffenders(file: string, source: string, inDesignSystem: boolean): Offender[] {
  const out: Offender[] = [];
  source.split("\n").forEach((text, i) => {
    for (const m of text.matchAll(PRIVATE_SIZE)) {
      const unit = /em["\]]/.test(m[0]) ? "em" : "px";
      out.push({ file, line: i + 1, detail: `${m[1] ?? m[2] ?? m[3] ?? m[4]}${unit}` });
    }
    for (const m of text.matchAll(MAP_INDEX)) {
      out.push({ file, line: i + 1, detail: m[0] });
    }
    if (!inDesignSystem) return;
    for (const pattern of PRIVATE_REM) {
      pattern.lastIndex = 0;
      for (const m of text.matchAll(pattern)) out.push({ file, line: i + 1, detail: `${m[1]}rem` });
    }
    for (const pattern of COMPUTED_SIZE) {
      pattern.lastIndex = 0;
      for (const m of text.matchAll(pattern)) {
        if (SCALED.test(m[1])) continue;
        out.push({ file, line: i + 1, detail: `computed font-size: ${m[1]}` });
      }
    }
  });
  return out;
}

describe("type scale", () => {
  it("detects rem/em rungs, sizeMap indices and raw computed font sizes", () => {
    const found = findTypographyOffenders("f.tsx", [
      'const sizeMap = { xs: "0.75rem", sm: "0.875rem" };',
      'style={{ "font-size": sizeMap[size] }}',
      '<p style={{ "font-size": "1.125rem" }} />',
      '<p className="text-[1.25rem]" />',
      'style={{ "font-size": `${side - 4}px` }}',
      '<code style={{ "font-size": "0.875em" }} />',
      '<code className="text-[1.1em]" />',
    ].join("\n"), true);
    expect(found.map((o) => o.detail)).toEqual([
      "0.75rem",
      "0.875rem",
      "sizeMap[",
      "1.125rem",
      "1.25rem",
      "computed font-size: ${side - 4}px",
      "0.875em",
      "1.1em",
    ]);
  });

  it("accepts token classes and ladder-derived computed sizes", () => {
    const found = findTypographyOffenders("f.tsx", [
      '<p className={TYPE_CLASS.micro} />',
      '<p className="text-ui-heading" />',
      'style={{ "font-size": `${typeSize("title")}px` }}',
      'style={{ "font-size": `${snapTypeSize(size * 0.4)}px` }}',
      'style={typeStyle("micro")}',
    ].join("\n"), true);
    expect(found).toEqual([]);
  });

  it("no component paints a private font size", () => {
    const offenders: Offender[] = [];
    for (const path of walk(SRC)) {
      if (/\.test\.|\.stories\./.test(path)) continue;
      offenders.push(...findTypographyOffenders(relative(SRC, path), readFileSync(path, "utf8"), path.startsWith(UI + sep)));
    }
    const report = offenders.map((o) => `${o.file}:${o.line} — ${o.detail}`).join("\n");
    expect(
      offenders,
      `\n${report}\n\nUse text-ui-* / typeSize() / typeStyle() from @/ui.`,
    ).toEqual([]);
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
