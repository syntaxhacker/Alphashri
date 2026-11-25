#!/usr/bin/env node
/**
 * Cross-check screenshot URLs quoted in a GitHub PR against the tracked
 * docs/screenshots files at the PR head.
 *
 *   node scripts/check-evidence-urls.mjs 272
 *   node scripts/check-evidence-urls.mjs https://github.com/owner/repo/pull/272
 *
 * Checks:
 *   - every referenced raw URL returns 200 at the head commit;
 *   - the referenced screenshot set equals the tracked set for each feature
 *     the PR talks about;
 *   - old/removed names referenced by the PR return 404 at the head commit.
 *
 * Network is skipped (exit 0 with a message) when the gh CLI is missing or not
 * authenticated. No GitHub API token is read or printed.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const USAGE = "Usage: node scripts/check-evidence-urls.mjs <pr-number-or-url>";
const RAW_PATTERN = /https?:\/\/[^\s<>()"']+/g;

function run(command, args) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function ghAuthenticated() {
  try {
    execFileSync("gh", ["auth", "status"], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function isRawScreenshotUrl(url) {
  return (
    /^https:\/\/raw\.githubusercontent\.com\//i.test(url) ||
    /^https:\/\/(www\.)?github\.com\/[^/]+\/[^/]+\/raw\//i.test(url)
  );
}

function screenshotPath(url) {
  const parsed = new URL(url);
  const marker = "/docs/screenshots/";
  const index = parsed.pathname.indexOf(marker);
  if (index === -1) return null;
  const path = decodeURIComponent(parsed.pathname.slice(index + 1));
  return path.endsWith(".png") ? path : null;
}

async function fetchStatus(url) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: { "User-Agent": "alphashri-evidence-url-check" },
  });
  await response.body?.cancel();
  return response.status;
}

async function mapLimit(items, limit, task) {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}
if (args.length !== 1) {
  console.error(USAGE);
  process.exit(1);
}
const pr = args[0];

if (!ghAuthenticated()) {
  console.log("[evidence-urls] gh CLI is missing or not authenticated; skipping network checks.");
  process.exit(0);
}

let repo;
let prData;
try {
  repo = run("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  prData = JSON.parse(run("gh", ["pr", "view", pr, "--json", "headRefOid,body,comments"]));
} catch (error) {
  console.error(
    `[evidence-urls] cannot read PR ${pr}: ${error.stderr?.toString().trim() || error.message}`,
  );
  process.exit(1);
}

const head = prData.headRefOid;
if (typeof head !== "string" || !/^[0-9a-f]{40}$/i.test(head)) {
  console.error(`[evidence-urls] PR ${pr} has no usable headRefOid.`);
  process.exit(1);
}

const text = [
  prData.body ?? "",
  ...(prData.comments ?? []).map((comment) => comment.body ?? ""),
].join("\n");
const rawUrls = [
  ...new Set((text.match(RAW_PATTERN) ?? []).map((url) => url.replace(/[.,;:]+$/, ""))),
].filter(isRawScreenshotUrl);

if (rawUrls.length === 0) {
  console.error(`[evidence-urls] no raw screenshot URLs found in PR ${pr}.`);
  process.exit(1);
}

const referenced = new Map();
for (const url of rawUrls) {
  const path = screenshotPath(url);
  if (path) referenced.set(url, path);
}

const tracked = run("git", ["ls-files", "--", "docs/screenshots"])
  .split("\n")
  .filter((path) => path.endsWith(".png"));
const features = new Set([...referenced.values()].map((path) => path.split("/")[2]));
const trackedSet = new Set(tracked.filter((path) => features.has(path.split("/")[2])));

const trackedUrlChecks = await mapLimit([...referenced.entries()], 6, async ([url, path]) => ({
  url,
  path,
  status: await fetchStatus(url),
  tracked: trackedSet.has(path),
}));

const removedPaths = [...referenced.values()].filter((path) => !trackedSet.has(path));
const removedChecks = await mapLimit(removedPaths, 6, async (path) => {
  const canonical = `https://raw.githubusercontent.com/${repo}/${head}/${path}`;
  return { path, status: await fetchStatus(canonical) };
});

const missing = [...trackedSet].filter((path) => !new Set(referenced.values()).has(path));
const extra = [...new Set(referenced.values())].filter((path) => !trackedSet.has(path));
const badStatuses = trackedUrlChecks.filter((check) => check.status !== 200);
const resurrected = removedChecks.filter((check) => check.status !== 404);

console.log(
  `[evidence-urls] PR ${pr} (${repo}@${head.slice(0, 12)}): ` +
    `${referenced.size} URL(s), ${trackedSet.size} tracked PNG(s) in ${[...features].join(", ")}.`,
);

const failures = [];
if (missing.length > 0) failures.push(`unreferenced tracked PNG(s): ${missing.join(", ")}`);
if (extra.length > 0) failures.push(`referenced name(s) not tracked at head: ${extra.join(", ")}`);
for (const check of badStatuses) {
  failures.push(`${check.status} ${check.url} (${check.tracked ? "tracked" : "removed"})`);
}
for (const check of resurrected) {
  failures.push(`removed name still resolves (${check.status}): ${check.path}`);
}

if (failures.length > 0) {
  console.error("\n[evidence-urls] Problems:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("[evidence-urls] all referenced URLs resolve and match the tracked screenshot set.");
