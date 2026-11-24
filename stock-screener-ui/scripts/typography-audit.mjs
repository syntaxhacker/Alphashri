#!/usr/bin/env node
/**
 * Typography audit.
 *
 * Reports private font-size declarations outside the six-step
 * `text-ui-*` scale. Used during migration and by the design-system review.
 *
 *   node scripts/typography-audit.mjs           # report only
 *   node scripts/typography-audit.mjs --check   # fail on below-floor sizes
 *   node scripts/typography-audit.mjs --strict  # fail on any private size
 *
 * px and rem literals, private alias ladders and named-map indexing are scanned
 * repo-wide. Computed declarations are scanned in `src/ui` — the layer that
 * owns aliases. A computed size is on-scale only when it comes from
 * TYPE_SCALE / typeSize() / typeStyle() / snapTypeSize(); anything else is a
 * private size even when its runtime number happens to be in the ladder.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const UI = join(SRC, "ui");
const SCALE = new Set([12, 13, 14, 16, 20, 24]);
const FLOOR = 12;
const REM_ROOT_PX = 16;
const args = new Set(process.argv.slice(2));
const CHECK = args.has("--check") || args.has("--strict");
const STRICT = args.has("--strict");

/** Keep in sync with src/ui/typography.ts and src/tailwind.css. */
const TOKEN_CLASS = /text-ui-(micro|body|label|title|heading|display)\b/;

/** Literal px sizes — private wherever they appear. */
const RAW = [
  /text-\[(\d+(?:\.\d+)?)px\]/g,
  /"font-size"\s*:\s*"(\d+(?:\.\d+)?)px"/g,
  /font-size\s*=\s*"(\d+(?:\.\d+)?)"/g,
  /fontSize\s*:\s*(\d+(?:\.\d+)?)\b/g,
  /fontSize\s*:\s*"(\d+(?:\.\d+)?)px"/g,
  /"fontSize"\s*:\s*(\d+(?:\.\d+)?)\b/g,
];

/** rem literals and alias ladder values — private in the design-system layer. */
const REM = [
  /text-\[(\d+(?:\.\d+)?)rem\]/g,
  /"font-size"\s*:\s*"(\d+(?:\.\d+)?)rem"/g,
  /font-size\s*=\s*"(\d+(?:\.\d+)?)rem"/g,
  /fontSize\s*:\s*"(\d+(?:\.\d+)?)rem"/g,
  /\b(?:xs|sm|md|lg|xl)\s*:\s*"(\d+(?:\.\d+)?)rem"/g,
];

/** A named size ladder indexed at the point of use (e.g. sizeMap[size]). */
const MAP_INDEX = /\b(?:sizeMap|SIZE_MAP|fontSizeMap|FONT_SIZE_MAP)\s*\[/g;

/** Computed (template-literal) font-size declarations. */
/** Parent-relative em sizes are private too: they evade the token ladder. */
const EM = [
  /text-\[(\d+(?:\.\d+)?)em\]/g,
  /"font-size"\s*:\s*"(\d+(?:\.\d+)?)em"/g,
  /font-size\s*=\s*"(\d+(?:\.\d+)?)em"/g,
  /fontSize\s*:\s*"(\d+(?:\.\d+)?)em"/g,
];

const COMPUTED = [
  /"font-size"\s*:\s*`([^`]*)`/g,
  /"fontSize"\s*:\s*`([^`]*)`/g,
  /font-size\s*=\s*`([^`]*)`/g,
];
/** The only acceptable sources for a computed size. */
const SCALED = /\bTYPE_SCALE\b|\btypeSize\s*\(|\btypeStyle\s*\(|\bsnapTypeSize\s*\(/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(entry) && !/\.(test|stories)\./.test(entry)) out.push(path);
  }
  return out;
}

const byPx = new Map();
const byFile = new Map();
const below = [];
const computed = [];
let declarations = 0;
let tokenUses = 0;

function record(rel, line, px, detail) {
  declarations += 1;
  if (Number.isFinite(px)) byPx.set(px, (byPx.get(px) ?? 0) + 1);
  byFile.set(rel, (byFile.get(rel) ?? 0) + 1);
  if (Number.isFinite(px) && px < FLOOR) below.push(`${rel}:${line} (${px}px)`);
  computed.push(`${rel}:${line} — ${detail}`);
}

for (const path of walk(SRC)) {
  const rel = relative(ROOT, path);
  const inDesignSystem = path.startsWith(UI + sep);
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((lineText, index) => {
    if (TOKEN_CLASS.test(lineText)) tokenUses += 1;

    for (const pattern of RAW) {
      pattern.lastIndex = 0;
      for (const match of lineText.matchAll(pattern)) record(rel, index + 1, Number(match[1]), `${match[0]} (px)`);
    }
    for (const match of lineText.matchAll(MAP_INDEX)) record(rel, index + 1, NaN, match[0]);

    for (const pattern of REM) {
      pattern.lastIndex = 0;
      for (const match of lineText.matchAll(pattern)) {
        record(rel, index + 1, Number(match[1]) * REM_ROOT_PX, `${match[0]} (rem)`);
      }
    }
    for (const pattern of EM) {
      pattern.lastIndex = 0;
      for (const match of lineText.matchAll(pattern)) {
        record(rel, index + 1, NaN, `${match[0]} (em)`);
      }
    }
    if (!inDesignSystem) return;

    for (const pattern of COMPUTED) {
      pattern.lastIndex = 0;
      for (const match of lineText.matchAll(pattern)) {
        if (SCALED.test(match[1])) continue;
        record(rel, index + 1, NaN, `computed: ${match[1]}`);
      }
    }
  });
}

const sizes = [...byPx.entries()].sort((a, b) => a[0] - b[0]);
const offScale = sizes.filter(([px]) => !SCALE.has(px));
const files = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

console.log("Typography audit (non-test, non-story source)");
console.log(`  token utilities used:        ${tokenUses}`);
console.log(`  private size declarations:   ${declarations}`);
console.log(`  sizes: ${sizes.map(([px, n]) => `${px}px×${n}`).join("  ") || "none"}`);
if (offScale.length > 0) {
  console.log(`  off-scale sizes: ${offScale.map(([px, n]) => `${px}px×${n}`).join("  ")}`);
}
if (files.length > 0) {
  console.log("  top files:");
  for (const [file, count] of files) console.log(`    ${count.toString().padStart(4)}  ${file}`);
}
if (below.length > 0) {
  console.log(`  below the 12px floor (${below.length}):`);
  for (const line of below.slice(0, 50)) console.log(`    ${line}`);
  if (below.length > 50) console.log(`    … ${below.length - 50} more`);
}
if (computed.length > 0) {
  console.log(`  computed / ladder index (${computed.length}):`);
  for (const line of computed.slice(0, 50)) console.log(`    ${line}`);
}

if (CHECK) {
  if (below.length > 0) {
    console.error(`\nFAIL: ${below.length} declaration(s) below the 12px floor.`);
    process.exit(1);
  }
  if (STRICT && declarations > 0) {
    console.error(`\nFAIL: ${declarations} private size declaration(s); use text-ui-* or typeStyle().`);
    process.exit(1);
  }
  console.log("\nPASS: no text below the 12px floor.");
}
