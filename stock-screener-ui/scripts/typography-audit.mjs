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
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const SCALE = new Set([12, 13, 14, 16, 20, 24]);
const FLOOR = 12;
const args = new Set(process.argv.slice(2));
const CHECK = args.has("--check") || args.has("--strict");
const STRICT = args.has("--strict");

/** Keep in sync with src/ui/typography.ts and src/tailwind.css. */
const TOKEN_CLASS = /text-ui-(micro|body|label|title|heading|display)\b/;
const RAW = [
  /text-\[(\d+(?:\.\d+)?)px\]/g,
  /"font-size"\s*:\s*"(\d+(?:\.\d+)?)px"/g,
  /font-size\s*=\s*"(\d+(?:\.\d+)?)"/g,
  /fontSize\s*:\s*(\d+(?:\.\d+)?)\b/g,
  /fontSize\s*:\s*"(\d+(?:\.\d+)?)px"/g,
  /"fontSize"\s*:\s*(\d+(?:\.\d+)?)\b/g,
];

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
let declarations = 0;
let tokenUses = 0;

for (const path of walk(SRC)) {
  const rel = relative(ROOT, path);
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, index) => {
    if (TOKEN_CLASS.test(line)) tokenUses += 1;
    for (const pattern of RAW) {
      pattern.lastIndex = 0;
      for (const match of line.matchAll(pattern)) {
        const px = Number(match[1]);
        if (!Number.isFinite(px)) continue;
        declarations += 1;
        byPx.set(px, (byPx.get(px) ?? 0) + 1);
        byFile.set(rel, (byFile.get(rel) ?? 0) + 1);
        if (px < FLOOR) below.push(`${rel}:${index + 1} (${px}px)`);
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

if (CHECK) {
  if (below.length > 0) {
    console.error(`\nFAIL: ${below.length} declaration(s) below the 12px floor.`);
    process.exit(1);
  }
  if (STRICT && offScale.length > 0) {
    console.error(`\nFAIL: ${declarations} private size declaration(s); use text-ui-* or typeStyle().`);
    process.exit(1);
  }
  console.log("\nPASS: no text below the 12px floor.");
}
