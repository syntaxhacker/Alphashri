// @vitest-environment node
/**
 * Guard: common components must not contain hardcoded color literals.
 * Colors come from ONE source: src/ui/palette.ts (via config/colors).
 * This catches any future component that inlines hex/rgba instead of
 * importing palette tokens or using MUI theme CSS variables.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..");
const COMMON = join(SRC, "components", "common");
const UI = join(SRC, "ui");

const ALLOWED = new Set([
  // theme definition is allowed to set raw values (primary + white)
  "ui/theme.tsx",
  // palette is THE source
  "ui/palette.ts",
  // playground is user-facing dev tooling
  "ui/ThemePlayground.tsx",
]);

// hex + rgb()/rgba() literals (not var() / palette constants)
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d[\d\s,.]*\)/g;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      out.push(...walk(p));
    } else if (/\.(ts|tsx|css)$/.test(name) && !name.endsWith(".test.") && !name.includes("stories")) {
      out.push(p);
    }
  }
  return out;
}

function rel(p: string): string {
  return p.replace(SRC + "/", "");
}

describe("color hygiene guard", () => {
  it("src/components/common has no hardcoded colors", () => {
    const offenders: string[] = [];
    for (const f of walk(COMMON)) {
      if (f.endsWith("colorHygiene.spec.ts")) continue; // this guard file contains the allowlist
      const txt = readFileSync(f, "utf8");
      const m = txt.match(COLOR_RE);
      if (m) offenders.push(`${rel(f)}: ${[...new Set(m)].slice(0, 4).join(", ")}`);
    }
    expect(offenders, "common components must import palette / use CSS vars").toEqual([]);
  });

  it("global src/style.css uses only palette-derived color literals", () => {
    const css = readFileSync(join(SRC, "style.css"), "utf8");
    // palette greens/reds/blacks used in rgba washes
    const ALLOWED_RGBA = [
      "rgba(63, 185, 80, 0.45)", // VOLUME_BULLISH (green up)
      "rgba(248, 81, 73, 0.45)", // VOLUME_BEARISH (red down)
      "rgba(13, 17, 23, 0.9)",   // BG #0D1117
      "rgba(1, 4, 9, 0.4)",      // BLACK #010409
    ];
    const rgbaRe = /rgba?\(\s*\d[\d\s,.]*\)/g;
    const raw = (css.match(rgbaRe) || []).filter(
      (v) => !ALLOWED_RGBA.includes(v),
    );
    expect(raw, "style.css rgba literals must be palette-derived").toEqual([]);
  });

  it("src/ui wrappers have no hardcoded colors (except theme + palette)", () => {
    const offenders: string[] = [];
    for (const f of walk(UI)) {
      const r = rel(f);
      if (ALLOWED.has(r)) continue;
      const txt = readFileSync(f, "utf8");
      const m = txt.match(COLOR_RE);
      if (m) offenders.push(`${r}: ${[...new Set(m)].slice(0, 4).join(", ")}`);
    }
    expect(offenders, "ui wrappers must pass through MUI theme").toEqual([]);
  });
});
