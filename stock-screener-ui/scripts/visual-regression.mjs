#!/usr/bin/env node
/**
 * Visual-regression gate for the design-system A+ review.
 *
 * Preconditions (checked before anything is launched):
 *   1. storybook-static/index.json exists and contains the six target stories.
 *   2. All 12 committed baseline PNGs exist, unless UPDATE_SNAPSHOTS=1.
 *
 * Then delegates the capture + pixel diff to playwright.visual.config.ts,
 * which starts its own short-lived static server against storybook-static/.
 *
 *   node scripts/visual-regression.mjs                       # verify
 *   UPDATE_SNAPSHOTS=1 node scripts/visual-regression.mjs    # (re)create baselines
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

const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";

function die(message) {
  console.error(`\n[visual-regression] ERROR\n\n${message}\n`);
  process.exit(1);
}

// 1. A static build is mandatory. Never fall back to the dev server or to a
//    pre-baked set of PNGs that do not correspond to the current source.
if (!existsSync(STATIC_INDEX)) {
  die(
    [
      `Static Storybook build not found: ${relative(ROOT, STATIC_INDEX)}`,
      "Build it first with:  npm run build-storybook",
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
      "Rebuild Storybook (npm run build-storybook) before running the gate.",
    ].join("\n"),
  );
}

// 2. Baselines are committed artefacts, not generated on a normal run.
const expectedBaselines = VIEWPORTS.flatMap((viewport) =>
  STORIES.map((story) => `${story.name}-${viewport.project}.png`),
);

if (!UPDATE) {
  const missingBaselines = expectedBaselines.filter(
    (name) => !existsSync(join(SHOTS_DIR, name)),
  );
  if (missingBaselines.length > 0) {
    die(
      [
        `Missing ${missingBaselines.length} of ${expectedBaselines.length} baseline screenshot(s) in ${relative(ROOT, SHOTS_DIR)}/:`,
        ...missingBaselines.map((name) => `  - ${name}`),
        "",
        "Create them once from a fresh static build, review the PNG diff, then commit:",
        "  UPDATE_SNAPSHOTS=1 node scripts/visual-regression.mjs",
      ].join("\n"),
    );
  }
} else {
  console.log("[visual-regression] UPDATE_SNAPSHOTS=1: baselines will be written/regenerated.");
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
