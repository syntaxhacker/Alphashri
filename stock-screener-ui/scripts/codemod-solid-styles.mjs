#!/usr/bin/env node
/**
 * Solid applies `style` objects with `style.setProperty(key, value)`, so a
 * camelCase key or a bare number is silently dropped — no error, no warning,
 * the declaration just never appears. This rewrites element `style={{ ... }}`
 * literals into the form that actually paints:
 *
 *   style={{ fontSize: 9, backgroundColor: bg, lineHeight: 1 }}
 *   style={{ "font-size": "9px", "background-color": bg, "line-height": 1 }}
 *
 * Only literal keys inside a literal object are rewritten. Spreads, computed
 * keys and `style={someExpr}` are left alone (hand-fix those), and the pass is
 * idempotent so it can be re-run after a rebase.
 *
 * Usage: node scripts/codemod-solid-styles.mjs [--write] <path...>
 *        node scripts/codemod-solid-styles.mjs --check <path...>
 */
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";

// Properties whose CSS value is a plain number (a unit would be invalid).
const UNITLESS = new Set([
  "opacity", "z-index", "flex", "flex-grow", "flex-shrink", "order",
  "line-height", "font-weight", "zoom", "tab-size", "column-count",
  "grid-column", "grid-row", "aspect-ratio", "animation-iteration-count",
  "fill-opacity", "stroke-opacity", "stroke-width", "stroke-dashoffset",
  "font-size-adjust", "orphans", "widows", "scale", "flex-order",
]);

const kebab = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Index just past the `}` that closes the object opened at `open`. */
function matchBrace(src, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Split an object body on top-level commas, keeping each part's text. */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  // Keep the trailing chunk even when it is only whitespace: it carries the
  // indentation that sits between the last property and the closing brace.
  parts.push(body.slice(start));
  return parts;
}

/** Rewrite one `style={{ ... }}` body, or return null when it is not literal. */
function rewriteStyleBody(body) {
  const parts = splitTopLevel(body);
  let changed = false;
  const out = parts.map((part) => {
    // Leading line/block comments belong to the declaration below them, so they
    // travel with it instead of blocking the rewrite.
    const m = part.match(
      /^((?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*)(["']?)([A-Za-z][\w-]*)\2(\s*:\s*)([\s\S]*?)(\s*)$/,
    );
    if (!m) return part;
    const [, lead, quote, rawKey, colon, rawValue, trail] = m;
    const key = /\p{Lu}/u.test(rawKey) ? kebab(rawKey) : rawKey;
    let value = rawValue;
    // A bare integer/float becomes a length, unless the property is unitless.
    // `0` needs no unit and Solid already writes it correctly.
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && value !== "0" && !UNITLESS.has(key)) {
      value = `"${value}px"`;
    }
    // A hyphenated key is not a valid identifier, so it must be quoted.
    const quoteOut = quote || key.includes("-") ? `"` : "";
    const next = `${lead}${quoteOut}${key}${quoteOut}${colon}${value}${trail}`;
    if (next !== part) changed = true;
    return next;
  });
  return changed ? out.join(",") : null;
}

function transform(src) {
  const chunks = [];
  let cursor = 0;
  let edits = 0;
  const marker = /style=\{\{/g;
  let m;
  while ((m = marker.exec(src))) {
    const open = m.index + m[0].length - 1; // the `{` of the object
    const close = matchBrace(src, open);
    if (close < 0) continue;
    const rewritten = rewriteStyleBody(src.slice(open + 1, close - 1));
    if (rewritten == null) continue;
    // `close - 1` is the closing `}`; keep it for the tail/next chunk so no
    // brace is lost, and let the body keep its own trailing whitespace.
    chunks.push(src.slice(cursor, open + 1), rewritten);
    cursor = close - 1;
    edits++;
    marker.lastIndex = close;
  }
  chunks.push(src.slice(cursor));
  return { code: chunks.join(""), edits };
}

function walk(target, files = []) {
  const st = statSync(target);
  if (st.isDirectory()) {
    for (const entry of readdirSync(target)) {
      if (entry === "node_modules" || entry === "dist") continue;
      walk(join(target, entry), files);
    }
    return files;
  }
  if ([".tsx", ".jsx"].includes(extname(target))) files.push(target);
  return files;
}

const args = process.argv.slice(2);
const write = args.includes("--write");
const check = args.includes("--check");
const targets = args.filter((a) => !a.startsWith("--"));
if (!targets.length) {
  console.error("usage: codemod-solid-styles.mjs [--write|--check] <path...>");
  process.exit(2);
}

let totalFiles = 0;
let totalEdits = 0;
const dirty = [];
for (const target of targets) {
  for (const file of walk(target)) {
    const src = readFileSync(file, "utf8");
    const { code, edits } = transform(src);
    if (!edits || code === src) continue;
    totalFiles++;
    totalEdits += edits;
    dirty.push(file);
    if (write) writeFileSync(file, code);
  }
}

const verb = write ? "rewrote" : check ? "would rewrite" : "found";
console.log(`codemod-solid-styles: ${verb} ${totalEdits} style object(s) in ${totalFiles} file(s)`);
for (const f of dirty) console.log(`  ${f}`);
if (check && dirty.length) process.exit(1);
