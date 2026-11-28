#!/usr/bin/env node
/**
 * Evidence guard for committed screenshot PNGs.
 *
 * Structural check only: each declared file must exist, be a valid PNG, be at
 * least 8 KiB, and carry the expected width/height in its IHDR header. Pixel
 * content is never decoded or rated — this is not a visual rater.
 *
 * The original 62-image gate stays in place. Feature folders may also carry a
 * `manifest.json` (feature, route, head, viewports, sha256, states). Those are
 * checked for exact file coverage, dimensions, byte size, SHA-256, duplicate
 * hashes (aliases only), and a stale `head` against the current src/api diff.
 *
 *   node scripts/evidence-audit.mjs                  # gate: exit 1 on any problem
 *   node scripts/evidence-audit.mjs --allow-missing  # non-gating pending report, exit 0
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIN_BYTES = 8 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SCREENSHOTS_ROOT = join(ROOT, "docs", "screenshots");

// --- Declared manifest -------------------------------------------------------
// App route captures are viewport-sized (exact dimensions). Storybook showcase
// captures are full-page, so only their width and a minimum height are fixed.
const VIEWPORTS = [
  { suffix: "1600", width: 1600, height: 1000 },
  { suffix: "390", width: 390, height: 844 },
];

const VIEWPORT_DIMENSIONS = new Map(
  VIEWPORTS.map((viewport) => [
    viewport.suffix,
    { width: viewport.width, height: viewport.height },
  ]),
);

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
    return {
      type: "missing",
      line: `${entry.path} (${entry.group}, expected ${expectation(entry)})`,
    };
  }
  if (!stat.isFile()) {
    return {
      type: "missing",
      line: `${entry.path} (not a regular file, expected ${expectation(entry)})`,
    };
  }

  const png = inspectPng(absPath);
  if (png.error) return { type: "invalid", line: `${entry.path} — ${png.error}` };
  if (png.size < MIN_BYTES) {
    return { type: "small", line: `${entry.path} — ${png.size} bytes < ${MIN_BYTES} minimum` };
  }

  const sizeOk =
    png.width === entry.width &&
    (entry.fullPage ? png.height >= entry.height : png.height === entry.height);
  if (!sizeOk) {
    return {
      type: "size",
      line: `${entry.path} — ${png.width}x${png.height}, expected ${expectation(entry)}`,
    };
  }
  return null;
}

function sha256(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

function git(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Feature folders that opted in by committing a manifest.json. */
function discoverManifestFeatures() {
  if (!existsSync(SCREENSHOTS_ROOT)) return [];
  return readdirSync(SCREENSHOTS_ROOT, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(SCREENSHOTS_ROOT, entry.name, "manifest.json")),
    )
    .map((entry) => entry.name)
    .sort();
}

function checkManifest(feature) {
  const relManifest = `docs/screenshots/${feature}/manifest.json`;
  const dir = join(SCREENSHOTS_ROOT, feature);
  const problems = [];
  const problem = (type, message) => problems.push({ type, line: `${relManifest} — ${message}` });

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  } catch (error) {
    problem("schema", `cannot read/parse manifest: ${error.message}`);
    return problems;
  }

  if (manifest.feature !== feature) {
    problem("schema", `feature "${manifest.feature}" does not match folder "${feature}"`);
  }
  if (typeof manifest.route !== "string" || !manifest.route.startsWith("/")) {
    problem("schema", "route must start with /");
  }
  if (typeof manifest.head !== "string" || !/^[0-9a-f]{7,40}$/i.test(manifest.head)) {
    problem("schema", "head must be a git commit hash");
  }
  if (!Array.isArray(manifest.viewports) || manifest.viewports.length === 0) {
    problem("schema", "viewports must be a non-empty array");
  } else {
    for (const viewport of manifest.viewports) {
      if (!VIEWPORT_DIMENSIONS.has(String(viewport))) {
        problem("schema", `unsupported viewport ${viewport}`);
      }
    }
    if (new Set(manifest.viewports.map(String)).size !== manifest.viewports.length) {
      problem("schema", "viewports must be unique");
    }
  }
  if (!manifest.sha256 || typeof manifest.sha256 !== "object" || Array.isArray(manifest.sha256)) {
    problem("schema", "sha256 must map file names to hashes");
  }
  if (!Array.isArray(manifest.states) || manifest.states.length === 0) {
    problem("schema", "states must be a non-empty array");
    return problems;
  }

  const viewports = new Set((manifest.viewports ?? []).map(String));
  const states = new Map();
  const files = new Map();

  for (const [index, state] of manifest.states.entries()) {
    if (!state || typeof state !== "object") {
      problem("schema", `states[${index}] is not an object`);
      continue;
    }
    if (typeof state.id !== "string" || !state.id) {
      problem("schema", `states[${index}].id is required`);
      continue;
    }
    if (states.has(state.id)) {
      problem("duplicate", `duplicate state id "${state.id}"`);
      continue;
    }
    states.set(state.id, state);

    if (typeof state.covers !== "string" || !state.covers.trim()) {
      problem("schema", `state "${state.id}" needs a covers description`);
    }
    if (!state.files || typeof state.files !== "object" || Array.isArray(state.files)) {
      problem("schema", `state "${state.id}" needs a files object`);
      continue;
    }
    const entries = Object.entries(state.files);
    if (entries.length === 0) problem("schema", `state "${state.id}" lists no files`);
    for (const [viewport, name] of entries) {
      if (!viewports.has(viewport)) {
        problem("schema", `state "${state.id}" uses undeclared viewport ${viewport}`);
      }
      if (
        typeof name !== "string" ||
        !name.endsWith(".png") ||
        name.includes("/") ||
        name.includes("..")
      ) {
        problem("schema", `state "${state.id}" has an invalid file for ${viewport}`);
        continue;
      }
      if (files.has(name)) {
        problem("duplicate", `${name} is listed by "${files.get(name).stateId}" and "${state.id}"`);
        continue;
      }
      files.set(name, { stateId: state.id, viewport });
    }
  }

  for (const state of states.values()) {
    if (state.aliasOf === undefined) continue;
    if (typeof state.aliasOf !== "string" || !state.aliasOf) {
      problem("schema", `state "${state.id}" has an invalid aliasOf`);
      continue;
    }
    const canonical = states.get(state.aliasOf);
    if (!canonical) {
      problem("alias", `state "${state.id}" aliases missing state "${state.aliasOf}"`);
      continue;
    }
    if (canonical.aliasOf !== undefined) {
      problem("alias", `state "${state.id}" aliases "${canonical.id}", which is itself an alias`);
      continue;
    }
    for (const [viewport, name] of Object.entries(state.files)) {
      const target = canonical.files?.[viewport];
      if (typeof target !== "string") {
        problem(
          "alias",
          `state "${state.id}" has no canonical ${viewport} file in "${canonical.id}"`,
        );
        continue;
      }
      if (manifest.sha256?.[name] !== manifest.sha256?.[target]) {
        problem("alias", `${name} does not match canonical ${target}`);
      }
    }
  }

  const actualFiles = readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".png"))
    .sort();
  for (const name of actualFiles) {
    if (!files.has(name)) {
      problem("unlisted", `${name} exists in the folder but is not listed in the manifest`);
    }
  }
  const actual = new Set(actualFiles);
  for (const name of files.keys()) {
    if (!actual.has(name))
      problem("missing", `${name} is listed in the manifest but missing on disk`);
  }

  const hashes = new Map();
  for (const [name, meta] of files) {
    if (!actual.has(name)) continue;
    const absPath = join(dir, name);
    const declared = manifest.sha256?.[name];
    if (typeof declared !== "string" || !/^[0-9a-f]{64}$/i.test(declared)) {
      problem("schema", `${name} has no valid sha256 entry`);
    }
    const png = inspectPng(absPath);
    if (png.error) {
      problem("invalid", `${name} — ${png.error}`);
      continue;
    }
    if (png.size < MIN_BYTES) {
      problem("small", `${name} — ${png.size} bytes < ${MIN_BYTES} minimum`);
    }
    const expected = VIEWPORT_DIMENSIONS.get(meta.viewport);
    if (!expected || png.width !== expected.width || png.height !== expected.height) {
      const expectedLabel = expected
        ? `${expected.width}x${expected.height}`
        : `viewport ${meta.viewport}`;
      problem("size", `${name} — ${png.width}x${png.height}, expected ${expectedLabel}`);
    }
    const digest = sha256(absPath);
    if (typeof declared === "string" && declared.toLowerCase() !== digest) {
      problem("hash", `${name} — sha256 ${digest} != declared ${declared}`);
    }
    hashes.set(name, digest);
  }

  const byHash = new Map();
  for (const [name, digest] of hashes) {
    if (!byHash.has(digest)) byHash.set(digest, []);
    byHash.get(digest).push(name);
  }
  for (const [digest, names] of byHash) {
    if (names.length < 2) continue;
    const canonical = names.filter((name) => {
      const state = states.get(files.get(name).stateId);
      return state?.aliasOf === undefined;
    });
    if (canonical.length !== 1) {
      problem(
        "duplicate-hash",
        `${names.join(", ")} share sha256 ${digest} without a single canonical file`,
      );
      continue;
    }
    for (const name of names) {
      const state = states.get(files.get(name).stateId);
      if (!state?.aliasOf) continue;
      const target = states.get(state.aliasOf)?.files?.[files.get(name).viewport];
      if (target !== canonical[0]) {
        problem(
          "duplicate-hash",
          `${name} shares ${digest} but its alias target is ${target ?? "missing"}, not ${canonical[0]}`,
        );
      }
    }
  }

  if (typeof manifest.head === "string" && /^[0-9a-f]{7,40}$/i.test(manifest.head)) {
    let resolved = "";
    try {
      resolved = git(["rev-parse", "--verify", `${manifest.head}^{commit}`]);
    } catch {
      // CI checks out with --depth=1, so a manifest head committed earlier on
      // the branch is absent locally. Fetch just that commit once and retry;
      // if the fetch is unavailable (offline, SHA not advertised), the stale
      // check below still reports it as missing.
      try {
        git(["fetch", "--quiet", "--depth=1", "origin", manifest.head]);
        resolved = git(["rev-parse", "--verify", `${manifest.head}^{commit}`]);
      } catch {
        problem("stale", `head ${manifest.head} is not a commit in this repository`);
      }
    }
    if (resolved) {
      const changed = new Set();
      try {
        // deletion-only src/api changes (e.g. removing an un-rendered module) do not invalidate screenshot evidence
        for (const path of git(["diff", "--name-only", "--diff-filter=d", resolved, "--", "src/api"])
          .split("\n")
          .filter(Boolean)) {
          changed.add(path);
        }
        for (const line of git(["status", "--porcelain", "--", "src/api"])
          .split("\n")
          .filter(Boolean)) {
          changed.add(
            line
              .slice(3)
              .trim()
              .replace(/^.* -> /, ""),
          );
        }
      } catch (error) {
        problem("stale", `cannot diff src/api against ${manifest.head}: ${error.message}`);
      }
      if (changed.size > 0) {
        problem(
          "stale",
          `head ${manifest.head} predates src/api changes: ${[...changed].sort().join(", ")}`,
        );
      }
    }
  }

  return problems;
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

const legacyProblems = MANIFEST.map(check).filter(Boolean);
const manifestFeatures = discoverManifestFeatures();
const manifestProblems = manifestFeatures.flatMap(checkManifest);
const problems = [...legacyProblems, ...manifestProblems];
const GROUPS = [
  ["missing", "Missing"],
  ["invalid", "Invalid PNG"],
  ["small", "Too small"],
  ["size", "Wrong dimensions"],
  ["schema", "Manifest schema"],
  ["hash", "SHA-256 mismatch"],
  ["alias", "Alias mismatch"],
  ["duplicate", "Duplicate listing"],
  ["unlisted", "Unlisted PNG"],
  ["duplicate-hash", "Duplicate hash"],
  ["stale", "Stale evidence head"],
];

console.log(
  `[evidence-audit] ${MANIFEST.length} required images (${APP_ROUTES.length * VIEWPORTS.length} app, ` +
    `${SHOWCASE_NAMES.length * VIEWPORTS.length} showcase): ` +
    `${MANIFEST.length - legacyProblems.length} ok, ${legacyProblems.length} problem(s).`,
);
if (manifestFeatures.length > 0) {
  const manifestFiles = manifestFeatures.reduce(
    (total, feature) =>
      total +
      readdirSync(join(SCREENSHOTS_ROOT, feature)).filter((name) =>
        name.toLowerCase().endsWith(".png"),
      ).length,
    0,
  );
  console.log(
    `[evidence-audit] ${manifestFeatures.length} feature manifest(s): ` +
      `${manifestFiles} PNG(s) checked in ${manifestFeatures.join(", ")}; ` +
      `${manifestProblems.length} problem(s).`,
  );
}

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
