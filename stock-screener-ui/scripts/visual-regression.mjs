#!/usr/bin/env node
/**
 * Visual-regression gate for the design-system A+ review.
 *
 * Preconditions (checked before anything is launched):
 *   1. storybook-static/index.json exists and contains the six target stories.
 *   2. All 12 committed baseline PNGs exist, unless UPDATE_SNAPSHOTS=1.
 *   3. Each baseline's IHDR matches its viewport contract: exact width, height
 *      at least the viewport height (captures are full-page), and >=8 KiB.
 *      Skipped in UPDATE_SNAPSHOTS=1 mode, where baselines are regenerated.
 *
 * Then delegates the capture + pixel diff to playwright.visual.config.ts,
 * which starts its own short-lived static server against storybook-static/.
 *
 *   node scripts/visual-regression.mjs                        # verify
 *   node scripts/visual-regression.mjs --preflight-only       # checks, no browser
 *   UPDATE_SNAPSHOTS=1 node scripts/visual-regression.mjs     # (re)create baselines
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const STATIC_INDEX = join(ROOT, "storybook-static", "index.json");
const SHOTS_DIR = join(ROOT, "tests", "visual", "__screenshots__");
const CONFIG = join(ROOT, "tests", "visual", "playwright.visual.config.ts");
const PLAYWRIGHT_CLI = join(ROOT, "node_modules", "@playwright", "test", "cli.js");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MIN_BASELINE_BYTES = 8 * 1024;

const PREFLIGHT_ONLY = process.argv.includes("--preflight-only");
const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";

const STORIES = [
  { name: "typography-landing", id: "design-system-typography--landing" },
  { name: "overview", id: "design-system-overview--overview" },
  { name: "inputs-landing", id: "design-system-inputs--landing" },
  { name: "data-display-landing", id: "design-system-data-display--family-landing" },
  { name: "overlay-landing", id: "design-system-overlay--family-landing" },
  { name: "foundations-landing", id: "design-system-foundations--landing" },
];

const VIEWPORTS = [
  { project: "desktop-1600", width: 1600, height: 1000 },
  { project: "mobile-390", width: 390, height: 844 },
];

const EXPECTED_BASELINES = VIEWPORTS.flatMap((viewport) =>
  STORIES.map((story) => ({
    name: `${story.name}-${viewport.project}.png`,
    viewport,
  })),
);
const NAME_WIDTH = Math.max(...EXPECTED_BASELINES.map((baseline) => baseline.name.length));

function die(message) {
  console.error(`\n[visual-regression] ERROR\n\n${message}\n`);
  process.exit(1);
}

function formatSize(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

// IHDR is the first PNG chunk: 8-byte signature, 4-byte length (13), 4-byte
// "IHDR" tag, then big-endian width/height. Reading those 24 bytes needs no
// image library; readFileSync is enough for the whole (small) baseline.
function readBaselineHeader(path) {
  let data;
  try {
    data = readFileSync(path);
  } catch {
    return { problem: "file missing or unreadable" };
  }
  if (data.length < MIN_BASELINE_BYTES) {
    return { problem: `${formatSize(data.length)} < 8 KiB minimum` };
  }
  if (!data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { problem: "not a PNG (bad signature)" };
  }
  if (data.readUInt32BE(8) !== 13 || data.subarray(12, 16).toString("ascii") !== "IHDR") {
    return { problem: "malformed PNG (IHDR chunk absent)" };
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width === 0 || height === 0) {
    return { problem: `invalid IHDR dimensions ${width}x${height}` };
  }
  return { width, height, bytes: data.length };
}

function preflightBaselines() {
  const rows = [];
  const failures = [];

  for (const { name, viewport } of EXPECTED_BASELINES) {
    const header = readBaselineHeader(join(SHOTS_DIR, name));
    if (header.problem) {
      rows.push(`  FAIL  ${name.padEnd(NAME_WIDTH)}  ${header.problem}`);
      failures.push(`  - ${name}: ${header.problem}`);
      continue;
    }

    const mismatches = [];
    if (header.width !== viewport.width) {
      mismatches.push(`width ${header.width} != ${viewport.width}`);
    }
    // Full-page captures are taller than the viewport by design; only a
    // too-short image proves the wrong viewport was used.
    if (header.height < viewport.height) {
      mismatches.push(`height ${header.height} < ${viewport.height}`);
    }

    rows.push(
      `  ${mismatches.length ? "FAIL" : "OK  "}  ${name.padEnd(NAME_WIDTH)}  ` +
        `${String(header.width).padStart(4)}x${String(header.height).padEnd(4)}  ` +
        formatSize(header.bytes),
    );
    if (mismatches.length) failures.push(`  - ${name}: ${mismatches.join("; ")}`);
  }

  console.log(
    `[visual-regression] Baseline preflight — ${EXPECTED_BASELINES.length} PNGs in ` +
      `${relative(ROOT, SHOTS_DIR)}/ (desktop 1600x>=1000, mobile 390x>=844, >=8 KiB):`,
  );
  console.log(rows.join("\n"));

  if (failures.length > 0) {
    die(
      [
        `Baseline preflight failed: ${failures.length} of ${EXPECTED_BASELINES.length} PNG(s) are invalid.`,
        "Desktop baselines must be 1600 px wide and at least 1000 px tall; mobile 390 px wide",
        "and at least 844 px tall (full-page captures may be taller). Minimum file size 8 KiB.",
        "",
        ...failures,
        "",
        "Regenerate with: UPDATE_SNAPSHOTS=1 node scripts/visual-regression.mjs",
      ].join("\n"),
    );
  }

  console.log(
    `[visual-regression] Baseline preflight passed: ${EXPECTED_BASELINES.length}/${EXPECTED_BASELINES.length} ` +
      "(dimensions and size OK).",
  );
}

// 1. A static build is mandatory. Never fall back to the dev server or to a
//    pre-baked set of PNGs that do not correspond to the current source.
if (!existsSync(STATIC_INDEX)) {
  die(
    [
      `Static Storybook build not found: ${relative(ROOT, STATIC_INDEX)}`,
      "Build it first with:  bun run build-storybook",
      "This gate runs only when a static build exists.",
    ].join("\n"),
  );
}

let index;
try {
  index = JSON.parse(readFileSync(STATIC_INDEX, "utf8"));
} catch (error) {
  die(`Cannot parse ${relative(ROOT, STATIC_INDEX)}: ${error.message}`);
}

const entries = (index && index.entries) || {};
const missingStories = STORIES.filter((story) => !entries[story.id]).map((story) => story.id);
if (missingStories.length > 0) {
  die(
    [
      `${relative(ROOT, STATIC_INDEX)} is stale: ${missingStories.length} target story/stories are absent:`,
      ...missingStories.map((id) => `  - ${id}`),
      "Rebuild Storybook (bun run build-storybook) before running the gate.",
    ].join("\n"),
  );
}

// 2. Baselines are committed artefacts, not generated on a normal run.
// 3. IHDR/size preflight guards against a wrong viewport or a blank/placeholder
//    file being committed as a baseline. Update mode regenerates the PNGs, so
//    the checks below are deliberately skipped there.
if (!UPDATE) {
  const missingBaselines = EXPECTED_BASELINES.map((baseline) => baseline.name).filter(
    (name) => !existsSync(join(SHOTS_DIR, name)),
  );
  if (missingBaselines.length > 0) {
    die(
      [
        `Missing ${missingBaselines.length} of ${EXPECTED_BASELINES.length} baseline screenshot(s) in ${relative(ROOT, SHOTS_DIR)}/:`,
        ...missingBaselines.map((name) => `  - ${name}`),
        "",
        "Create them once from a fresh static build, review the PNG diff, then commit:",
        "  UPDATE_SNAPSHOTS=1 node scripts/visual-regression.mjs",
      ].join("\n"),
    );
  }
  preflightBaselines();
} else {
  console.log(
    "[visual-regression] UPDATE_SNAPSHOTS=1: baselines will be written/regenerated (IHDR preflight skipped).",
  );
}

if (PREFLIGHT_ONLY) {
  console.log(
    UPDATE
      ? "[visual-regression] --preflight-only: nothing to verify in update mode; browser not launched."
      : "[visual-regression] --preflight-only: preflight complete, browser not launched.",
  );
  process.exit(0);
}

if (!existsSync(PLAYWRIGHT_CLI)) {
  die("Playwright is not installed. Run `npm install` from stock-screener-ui.");
}

const args = [PLAYWRIGHT_CLI, "test", "--config", CONFIG];
if (UPDATE) args.push("--update-snapshots");

const result = spawnSync(process.execPath, args, {
  cwd: ROOT,
  stdio: "inherit",
  env: process.env,
});

if (result.error) die(`Failed to launch Playwright: ${result.error.message}`);
process.exit(result.status ?? 1);
