// @vitest-environment node
/**
 * Solid writes `style` objects through `style.setProperty(key, value)`, which
 * requires a kebab-case property name and a string value. A camelCase key or a
 * bare number is dropped with no error and no warning, so the declaration never
 * paints. That failure is invisible in review, which is why it is a guard.
 *
 * Fix with: node scripts/codemod-solid-styles.mjs --write src
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SELF = fileURLToPath(import.meta.url);

// Properties whose CSS value is legitimately a bare number.
const UNITLESS = new Set([
  "opacity", "z-index", "flex", "flex-grow", "flex-shrink", "order",
  "line-height", "font-weight", "zoom", "tab-size", "column-count",
  "grid-column", "grid-row", "aspect-ratio", "animation-iteration-count",
  "fill-opacity", "stroke-opacity", "stroke-width", "stroke-dashoffset",
  "font-size-adjust", "orphans", "widows", "scale", "flex-order",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx|jsx)$/.test(entry)) out.push(path);
  }
  return out;
}

/** Index just past the `}` closing the object opened at `open`. */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

interface Offender {
  file: string;
  line: number;
  detail: string;
}

/** Every literal `style={{...}}` object is checked; computed ones are skipped. */
export function findStyleOffenders(file: string, src: string): Offender[] {
  const offenders: Offender[] = [];
  const lineOf = (index: number) => src.slice(0, index).split("\n").length;
  const marker = /style=\{\{/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(src))) {
    const objectStart = match.index + match[0].length - 1;
    const objectEnd = matchBrace(src, objectStart);
    if (objectEnd < 0) continue;
    const body = src.slice(objectStart + 1, objectEnd - 1);
    for (const declaration of body.split(",")) {
      const keyMatch = declaration.match(/(["']?)([A-Za-z][\w-]*)\1\s*:\s*([^,]*)/);
      if (!keyMatch) continue;
      const key = keyMatch[2];
      const value = keyMatch[3].trim();
      if (/[a-z][A-Z]/.test(key)) {
        offenders.push({ file, line: lineOf(match.index), detail: `camelCase key \`${key}\`` });
        continue;
      }
      if (NUMBER.test(value) && value !== "0" && !UNITLESS.has(key)) {
        offenders.push({ file, line: lineOf(match.index), detail: `numeric value for \`${key}\` (needs px)` });
      }
    }
    marker.lastIndex = objectEnd;
  }
  return offenders;
}

describe("Solid style objects", () => {
  it("detects the two silent-drop shapes", () => {
    const offenders = findStyleOffenders("fixture.tsx", [
      "const a = <div style={{ fontSize: 9, backgroundColor: bg }} />;",
      "const b = <div style={{ \"font-size\": \"9px\" }} />;",
      "const c = <div style={{ lineHeight: 1, zIndex: 2 }} />;",
      "const d = <div style={{ ...rest, width: 40 }} />;",
    ].join("\n"));
    expect(offenders.map((o) => o.detail)).toEqual([
      "camelCase key `fontSize`",
      "camelCase key `backgroundColor`",
      "camelCase key `lineHeight`",
      "camelCase key `zIndex`",
      "numeric value for `width` (needs px)",
    ]);
  });

  it("has no camelCase keys or unitless lengths in src", () => {
    const offenders: Offender[] = [];
    for (const path of walk(SRC)) {
      if (path === SELF) continue;
      offenders.push(...findStyleOffenders(relative(SRC, path), readFileSync(path, "utf8")));
    }
    const report = offenders.map((o) => `${o.file}:${o.line} — ${o.detail}`).join("\n");
    expect(offenders, `\n${report}\n\nRun: node scripts/codemod-solid-styles.mjs --write src`).toEqual([]);
  });
});
