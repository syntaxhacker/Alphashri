#!/usr/bin/env node
/**
 * Generic screenshot-evidence manifest writer. Run it AFTER a parallel capture,
 * not from a test: a serial "writes the manifest" test is what forces the
 * whole evidence block back into one worker.
 *
 * Usage:
 *   node scripts/evidence/write-manifest.mjs \
 *     --feature sector-single-page \
 *     --dir docs/screenshots/sector-single-page \
 *     --states scripts/evidence/sector-states.json \
 *     --source mock [--head <sha>] [--route /sector] \
 *     [--viewports 1600,390] [--prune] [--dry-run]
 *
 * --states accepts a JSON file path or inline JSON. The JSON is an array of
 * { id, covers, mode?, mock? } (or { states: [...] }). Filenames are derived as
 * `${id}-${viewport}.png`; every file must already exist. `--dry-run` prints the
 * manifest without writing, so it is safe in verification runs.
 *
 * --head defaults to GITHUB_SHA, then `git rev-parse HEAD`. --source mock writes
 * per-state mock:true and top-level source:"route-mocks"; any other value writes
 * mock:false and source:"real-api". --prune removes stray PNGs from --dir.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

const HELP = `Usage: node scripts/evidence/write-manifest.mjs [options]

  --feature <name>   Manifest feature name (required)
  --dir <path>       Capture directory containing the PNGs (required)
  --states <path|json>  States JSON file or inline JSON (required)
  --source <mock|real-api>  Evidence source (default: mock)
  --head <sha>       Commit SHA (default: GITHUB_SHA, then git rev-parse HEAD)
  --route <path>     Route recorded in the manifest (default: /sector)
  --viewports <list> Comma-separated widths (default: 1600,390)
  --prune            Delete PNGs in --dir that are not in the manifest
  --dry-run          Print the manifest; write nothing
  --help             Show this help
`;

function fail(message) {
  process.stderr.write(`write-manifest: ${message}\n`);
  process.exitCode = 1;
}

function resolveHead(explicit) {
  if (explicit) return explicit;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    fail("cannot resolve the commit head; pass --head or set GITHUB_SHA");
    return null;
  }
}

function loadStates(source) {
  let raw = source;
  if (existsSync(source)) raw = readFileSync(source, "utf8");
  const parsed = JSON.parse(raw);
  const states = Array.isArray(parsed) ? parsed : parsed.states;
  if (!Array.isArray(states)) {
    throw new Error("--states must be an array of { id, covers } or { states: [...] }");
  }
  for (const state of states) {
    if (typeof state?.id !== "string" || !state.id) {
      throw new Error("--states entries all need a non-empty string id");
    }
  }
  return states;
}

function main() {
  let args;
  try {
    args = parseArgs({
      options: {
        feature: { type: "string" },
        dir: { type: "string" },
        states: { type: "string" },
        head: { type: "string" },
        source: { type: "string", default: "mock" },
        route: { type: "string", default: "/sector" },
        viewports: { type: "string", default: "1600,390" },
        prune: { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
      strict: true,
    }).values;
  } catch (error) {
    fail(error.message);
    return;
  }
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  for (const key of ["feature", "dir", "states"]) {
    if (!args[key]) {
      fail(`missing required --${key} (see --help)`);
      return;
    }
  }
  if (args.source !== "mock" && args.source !== "real-api") {
    fail("--source must be mock or real-api");
    return;
  }

  const head = resolveHead(args.head);
  if (!head) return;
  const viewports = args.viewports
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((width) => Number.isInteger(width) && width > 0);
  if (!viewports.length) {
    fail("--viewports must contain at least one positive integer width");
    return;
  }

  let states;
  try {
    states = loadStates(args.states);
  } catch (error) {
    fail(error.message);
    return;
  }

  const dir = path.resolve(args.dir);
  const manifestStates = states.map((state) => {
    const mock = typeof state.mock === "boolean" ? state.mock : args.source === "mock";
    return {
      id: state.mode === "loaded" ? `${state.id}-loaded` : state.id,
      files: Object.fromEntries(
        viewports.map((width) => [String(width), `${state.id}-${width}.png`]),
      ),
      covers: state.covers ?? "",
      mock,
    };
  });

  const sha256 = {};
  const keep = new Set();
  const missing = [];
  for (const state of states) {
    for (const width of viewports) {
      const name = `${state.id}-${width}.png`;
      const file = path.join(dir, name);
      if (!existsSync(file)) {
        missing.push(name);
        continue;
      }
      sha256[name] = createHash("sha256").update(readFileSync(file)).digest("hex");
      keep.add(name);
    }
  }
  if (missing.length) {
    fail(`missing ${missing.length} capture(s): ${missing.slice(0, 8).join(", ")}`);
    return;
  }

  const source = args.source === "mock" ? "route-mocks" : "real-api";
  const manifest = {
    feature: args.feature,
    route: args.route,
    head,
    viewports,
    sha256,
    states: manifestStates,
    source,
  };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  if (args["dry-run"]) {
    process.stdout.write(text);
    return;
  }

  if (args.prune) {
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".png") && !keep.has(name)) rmSync(path.join(dir, name));
    }
  }
  const tmp = path.join(dir, ".manifest.json.tmp");
  writeFileSync(tmp, text);
  renameSync(tmp, path.join(dir, "manifest.json"));
  process.stdout.write(
    `wrote ${path.join(dir, "manifest.json")} (${manifestStates.length} states, ${keep.size} sha256 entries)\n`,
  );
}

main();
