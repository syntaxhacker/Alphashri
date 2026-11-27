#!/usr/bin/env node
/**
 * PR screenshot gate.
 *
 * A PR body must embed at least one accessible screenshot:
 *   ![alt](https://…/shot.png)
 *   <img src="https://…/shot.png" />
 *
 * Local paths (`.agent-artifacts/...`, `/workspaces/...`, `file://...`) are not
 * evidence: reviewers cannot open them from the PR page.
 *
 * Bypass for non-UI changes:
 *   - label `skip-screenshot-gate` (or `no-screenshots-needed`), or
 *   - body marker `<!-- screenshot-gate: skip -->`.
 */
import { appendFileSync } from "node:fs";

const body = process.env.PR_BODY ?? "";
const labels = (process.env.PR_LABELS ?? "")
  .split(",")
  .map((label) => label.trim().toLowerCase())
  .filter(Boolean);

const BYPASS_LABELS = new Set(["skip-screenshot-gate", "no-screenshots-needed"]);
const BYPASS_MARKER = /<!--\s*screenshot-gate:\s*(?:skip|bypass)\b[^>]*-->/i;

function writeSummary(lines) {
  const text = `${lines.join("\n")}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  }
  console.log(text);
}

if (labels.some((label) => BYPASS_LABELS.has(label)) || BYPASS_MARKER.test(body)) {
  writeSummary([
    "### Screenshot gate: bypassed",
    "Skipped by label or `<!-- screenshot-gate: skip -->`.",
  ]);
  process.exit(0);
}

const candidates = [];
for (const match of body.matchAll(
  /!\[[^\]]*\]\((https?:\/\/[^)\s]+)(?:\s+["'][^"']*["'])?\)/g,
)) {
  candidates.push(match[1]);
}
for (const match of body.matchAll(
  /<img\b[^>]*\bsrc\s*=\s*["'](https?:\/\/[^"']+)["']/gi,
)) {
  candidates.push(match[1]);
}

function isScreenshot(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (host === "img.shields.io" || host.endsWith(".shields.io") || host.includes("badge")) {
    return false;
  }
  const path = url.pathname.toLowerCase();
  if (/\.(png|jpe?g|gif|webp)$/.test(path)) return true;
  if (host === "github.com" && path.startsWith("/user-attachments/assets/")) return true;
  if (
    (host === "raw.githubusercontent.com" ||
      host === "user-images.githubusercontent.com" ||
      host === "private-user-images.githubusercontent.com") &&
    /\.(png|jpe?g|gif|webp)$/.test(path)
  ) {
    return true;
  }
  return false;
}

const images = [...new Set(candidates.filter(isScreenshot))];
const localImages =
  body.match(/!\[[^\]]*\]\((\/[^)]*|\.{1,2}\/[^)]*|file:\/\/[^)]*)\)/g) ?? [];
if (images.length === 0) {
  const lines = [
    "### Screenshot gate: failed",
    "- No embedded screenshot found in the PR body.",
    "- Add at least one image with `![alt](https://…)` or `<img src=\"https://…\">`.",
    "- Local paths (`.agent-artifacts/...`, `/workspaces/...`, `file://...`) do not render for reviewers.",
  ];
  if (localImages.length > 0) {
    lines.push(`- Found ${localImages.length} local image path(s) that cannot render.`);
  }
  lines.push(
    "",
    "Bypass for non-UI changes: add label `skip-screenshot-gate` or body marker `<!-- screenshot-gate: skip -->`.",
  );
  writeSummary(lines);
  console.error(
    "::error title=Screenshots missing::Attach an embedded screenshot to the PR body, or add the skip-screenshot-gate label for a non-UI change.",
  );
  process.exit(1);
}

async function checkImageUrl(url) {
  for (const method of ["HEAD", "GET"]) {
    try {
      const response = await fetch(url, {
        method,
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
        headers: method === "GET" ? { Range: "bytes=0-0" } : undefined,
      });
      if (response.status === 404 || response.status === 410) {
        return { ok: false, status: response.status };
      }
      if (response.status >= 200 && response.status < 400) {
        return { ok: true, status: response.status };
      }
      if (method === "HEAD" && (response.status === 403 || response.status === 405)) {
        continue;
      }
      return { ok: false, status: response.status };
    } catch (error) {
      if (method === "HEAD") continue;
      return { ok: false, status: 0, error: String(error).slice(0, 80) };
    }
  }
  return { ok: false, status: 0 };
}

const checks = await Promise.all(
  images.map(async (url) => ({ url, ...(await checkImageUrl(url)) })),
);
const broken = checks.filter((check) => !check.ok);

if (broken.length > 0) {
  writeSummary([
    "### Screenshot gate: broken image URL(s)",
    ...broken.map(
      (check) =>
        `- ${check.url} → ${check.status || check.error || "unreachable"}`,
    ),
    "",
    "Use an immutable raw URL (commit SHA) or a GitHub attachment; branch URLs break when the branch is deleted.",
  ]);
  console.error(
    `::error title=Screenshot URL unreachable::${broken
      .map((check) => `${check.url} (${check.status || check.error || "unreachable"})`)
      .join(", ")}`,
  );
  process.exit(1);
}

writeSummary([
  "### Screenshot gate: passed",
  `Found ${images.length} embedded screenshot URL(s); all returned a reachable status.`,
  ...images.slice(0, 8).map((url) => `- ${url}`),
]);
