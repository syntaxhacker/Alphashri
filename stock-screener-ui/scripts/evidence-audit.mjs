#!/usr/bin/env node
/**
 * Evidence guard for committed screenshot PNGs.
 *
 * Structural check only: each declared file must exist, be a valid PNG, be at
 * least 8 KiB, and carry the expected width/height in its IHDR header. Pixel
 * content is never decoded or rated — this is not a visual rater.
 *
 *   node scripts/evidence-audit.mjs                  # gate: exit 1 on any problem
 *   node scripts/evidence-audit.mjs --allow-missing  # non-gating pending report, exit 0
 */
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIN_BYTES = 8 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// --- Declared manifest -------------------------------------------------------
// App route captures are viewport-sized (exact dimensions). Storybook showcase
// captures are full-page, so only their width and a minimum height are fixed.
const VIEWPORTS = [
  { suffix: "1600", width: 1600, height: 1000 },
  { suffix: "390", width: 390, height: 844 },
];

// Options is explicitly out of scope for the design-system evidence wave (it
// has its own feature spec); it is deliberately not a manifest route.
const APP_ROUTES = ["report", "sector", "home", "screener", "patterns"];

const SHOWCASE_NAMES = [
  // Family landings
  "overview",
  "foundations",
  "typography",
  "layout",
  "inputs",
  "data-display",
  "feedback",
  "navigation",
  "overlay",
  "portal",
  "shared-primitives",
  "app-primitives",
  "misc",
  // Component pages
  "alerts",
  "buttons",
  "grid",
  "keyvalue",
  "loader",
  "notifications",
  "select",
  "skeleton",
  "table",
  // Result states and focus ring
  "result-empty",
  "result-scanning",
  "result-feed-error",
  "focus-ring",
];

const MANIFEST = [
  ...APP_ROUTES.flatMap((route) =>
    VIEWPORTS.map((vp) => ({
      path: `docs/screenshots/app/${route}-${vp.suffix}.png`,
      group: "app",
      fullPage: false,
      width: vp.width,
      height: vp.height,
    })),
  ),
  ...SHOWCASE_NAMES.flatMap((name) =>
    VIEWPORTS.map((vp) => ({
      path: `docs/screenshots/showcase/${name}-${vp.suffix}.png`,
      group: "showcase",
      fullPage: true,
      width: vp.width,
      height: vp.height,
    })),
  ),
];

function expectation(entry) {
  return entry.fullPage
    ? `width ${entry.width}, height >= ${entry.height} (full page)`
    : `${entry.width}x${entry.height}`;
}

/** Read the signature and IHDR only; no pixel data is touched. */
function inspectPng(absPath) {
  const size = statSync(absPath).size;
  const fd = openSync(absPath, "r");
  let header;
  try {
    const buf = Buffer.alloc(24);
    let read = 0;
    while (read < buf.length) {
      const n = readSync(fd, buf, read, buf.length - read, read);
      if (n === 0) break;
      read += n;
    }
    header = buf.subarray(0, read);
  } finally {
    closeSync(fd);
  }

  if (header.length < 24 || !header.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { size, error: "invalid PNG signature" };
  }
  if (header.readUInt32BE(8) !== 13 || header.toString("ascii", 12, 16) !== "IHDR") {
    return { size, error: "missing 13-byte IHDR chunk" };
  }
  const width = header.readUInt32BE(16);
  const height = header.readUInt32BE(20);
  if (width === 0 || height === 0) return { size, error: "zero dimension in IHDR" };
  return { size, width, height };
}

function check(entry) {
  const absPath = join(ROOT, entry.path);
  let stat;
  try {
    stat = statSync(absPath);
  } catch {
    return { type: "missing", line: `${entry.path} (${entry.group}, expected ${expectation(entry)})` };
  }
  if (!stat.isFile()) {
    return { type: "missing", line: `${entry.path} (not a regular file, expected ${expectation(entry)})` };
  }

  const png = inspectPng(absPath);
  if (png.error) return { type: "invalid", line: `${entry.path} — ${png.error}` };
  if (png.size < MIN_BYTES) {
    return { type: "small", line: `${entry.path} — ${png.size} bytes < ${MIN_BYTES} minimum` };
  }

  const sizeOk = png.width === entry.width && (entry.fullPage ? png.height >= entry.height : png.height === entry.height);
  if (!sizeOk) {
    return {
      type: "size",
      line: `${entry.path} — ${png.width}x${png.height}, expected ${expectation(entry)}`,
    };
  }
  return null;
}

const args = new Set(process.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
  console.log("Usage: node scripts/evidence-audit.mjs [--allow-missing]");
  process.exit(0);
}
const unknown = [...args].filter((arg) => arg !== "--allow-missing");
if (unknown.length > 0) {
  console.error(`[evidence-audit] Unknown argument(s): ${unknown.join(", ")}`);
  console.error("Usage: node scripts/evidence-audit.mjs [--allow-missing]");
  process.exit(1);
}
const ALLOW_MISSING = args.has("--allow-missing");

const problems = MANIFEST.map(check).filter(Boolean);
const GROUPS = [
  ["missing", "Missing"],
  ["invalid", "Invalid PNG"],
  ["small", "Too small"],
  ["size", "Wrong dimensions"],
];

console.log(
  `[evidence-audit] ${MANIFEST.length} required images (${APP_ROUTES.length * VIEWPORTS.length} app, ` +
    `${SHOWCASE_NAMES.length * VIEWPORTS.length} showcase): ` +
    `${MANIFEST.length - problems.length} ok, ${problems.length} problem(s).`,
);

if (problems.length > 0) {
  console.log(ALLOW_MISSING ? "\nPending evidence (non-gating):" : "\nProblems:");
  for (const [type, label] of GROUPS) {
    const lines = problems.filter((p) => p.type === type).map((p) => p.line);
    if (lines.length === 0) continue;
    console.log(`\n${label} (${lines.length}):`);
    for (const line of lines) console.log(`  - ${line}`);
  }
}

if (ALLOW_MISSING) {
  console.log("\nExiting 0 because --allow-missing was set; these are not gating results.");
  process.exit(0);
}
process.exit(problems.length === 0 ? 0 : 1);
