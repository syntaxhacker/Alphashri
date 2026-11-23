#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const SRC = join(ROOT, "src");
const GROUPS = ["ui", "components/common"];
const STORY_ROOT = join(SRC, "stories", "design-system");

const HEX = /#[0-9a-fA-F]{6}\b/g;
const LEGACY_RADIUS = /rounded-\[(8|12)px\]|"border-radius":\s*"(8|12)px"/g;
const MANTINE_STYLES = /styles=\{\{/g;
const REACT = /from "react(-dom)?"/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const sourceFiles = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f));
const sourceSet = new Set(sourceFiles);

function resolveSpecifier(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (sourceSet.has(candidate)) return candidate;
  }
  return null;
}

// Exported value names (types are ignored: a story cannot exercise a type at runtime).
function exportedNames(text) {
  const names = new Set();
  const declarations = /\bexport\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:const|let|var|function|class|enum)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of text.matchAll(declarations)) names.add(match[1]);
  for (const match of text.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(",")) {
      const clause = part.trim().replace(/^type\s+/, "");
      if (!clause) continue;
      const exported = clause.split(/\s+as\s+/).at(-1).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(exported)) names.add(exported);
    }
  }
  return names;
}

// `export { Button } from "./inputs/Button"` maps an imported barrel symbol to
// the module that actually declares it. Without this, a story importing from
// `@/ui` would only be credited to the barrel, not to Button.tsx.
function reexports(text, fromFile) {
  const map = new Map();
  const pattern = /\bexport\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  for (const match of text.matchAll(pattern)) {
    const target = resolveSpecifier(match[2], fromFile);
    if (!target) continue;
    for (const part of match[1].split(",")) {
      const clause = part.trim().replace(/^type\s+/, "");
      if (!clause) continue;
      const bits = clause.split(/\s+as\s+/);
      const exported = bits.at(-1).trim();
      const original = bits[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(exported)) map.set(exported, { file: target, name: original });
    }
  }
  return map;
}

function namedImports(text) {
  const out = [];
  const pattern = /\bimport\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  for (const match of text.matchAll(pattern)) {
    for (const part of match[1].split(",")) {
      const clause = part.trim().replace(/^type\s+/, "");
      if (!clause) continue;
      const bits = clause.split(/\s+as\s+/);
      out.push({ name: bits.at(-1).trim(), imported: bits[0].trim(), spec: match[2] });
    }
  }
  return out;
}

const files = GROUPS.flatMap((g) => walk(join(SRC, g))).filter(
  (f) => /\.tsx$/.test(f) && !/\.(test|stories|spec)\./.test(f),
);

const exportsByFile = new Map(files.map((f) => [f, exportedNames(readFileSync(f, "utf8"))]));

const allStories = walk(SRC).filter((f) => /\.stories\.tsx$/.test(f)).sort();
const centralizedStories = allStories.filter((f) => f.startsWith(STORY_ROOT + "/"));
const colocatedStories = allStories.filter((f) => !f.startsWith(STORY_ROOT + "/"));

// file -> { names:Set<exportedName>, stories:Set<storyFile> }
const usage = new Map(files.map((f) => [f, { names: new Set(), stories: new Set() }]));
let storyEntries = 0;

for (const storyFile of allStories) {
  const text = readFileSync(storyFile, "utf8");
  storyEntries += [...text.matchAll(/^export\s+const\s+[A-Za-z_$][\w$]*/gm)].length;
  const barrelCache = new Map();
  for (const imp of namedImports(text)) {
    const target = resolveSpecifier(imp.spec, storyFile);
    if (!target) continue;
    if (!barrelCache.has(target)) barrelCache.set(target, reexports(readFileSync(target, "utf8"), target));
    const mapped = barrelCache.get(target).get(imp.imported) ?? { file: target, name: imp.imported };
    const record = usage.get(mapped.file);
    if (record && exportsByFile.get(mapped.file).has(mapped.name)) {
      record.names.add(mapped.name);
      record.stories.add(storyFile);
    }
  }
}

const rows = [];
const violations = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const dir = file.slice(0, file.lastIndexOf("/"));
  const base = file.slice(file.lastIndexOf("/") + 1, -4);
  const siblings = readdirSync(dir);
  const hasLocalStory = siblings.some((n) => /\.stories\.tsx$/.test(n) && readFileSync(join(dir, n), "utf8").includes(base));
  const hasTest = siblings.some((n) => /\.test\.tsx$/.test(n) && readFileSync(join(dir, n), "utf8").includes(base));
  const record = usage.get(file);
  const storyNames = [...record.names].sort();
  const hasStory = storyNames.length > 0;
  const hexes = [...new Set(text.match(HEX) ?? [])];
  const legacy = [...new Set(text.match(LEGACY_RADIUS) ?? [])];
  const mantine = (text.match(MANTINE_STYLES) ?? []).length;
  const react = (text.match(REACT) ?? []).length;
  if (hexes.length) violations.push(`${relative(SRC, file)}: hardcoded ${hexes.join(", ")}`);
  if (legacy.length) violations.push(`${relative(SRC, file)}: legacy radius ${legacy.join(", ")}`);
  if (mantine) violations.push(`${relative(SRC, file)}: Mantine styles prop`);
  if (react) violations.push(`${relative(SRC, file)}: react import`);
  rows.push({
    file: relative(SRC, file),
    hasStory,
    hasLocalStory,
    storyNames,
    hasTest,
    hexes: hexes.length,
    legacy: legacy.length,
  });
}

rows.sort((a, b) => a.file.localeCompare(b.file));

const withStory = rows.filter((r) => r.hasStory).length;
const withTest = rows.filter((r) => r.hasTest).length;
const exercisedExports = new Set(rows.flatMap((r) => r.storyNames));

const table = rows
  .map(
    (r) =>
      `| \`${r.file}\` | ${r.hasStory ? "yes" : "—"} | ${r.storyNames.length ? r.storyNames.map((n) => `\`${n}\``).join(", ") : "—"} | ${r.hasTest ? "yes" : "—"} | ${r.hexes} | ${r.legacy} |`,
  )
  .join("\n");

const doc = `# Component audit

Generated by \`node scripts/component_audit.mjs\`. Do not edit by hand.

Scope: \`src/ui/**\` and \`src/components/common/**\` component modules (${rows.length} files).

## Story catalog

- Story files scanned: **${allStories.length}** (${centralizedStories.length} centralized under \`src/stories/design-system/\`, ${colocatedStories.length} co-located).
- Story entries parsed from \`export const …\`: **${storyEntries}**.
- Distinct exported component names imported by those stories: **${exercisedExports.size}**.
- A module is marked "yes" in the Story column only when a story imports one of its **actual exported names**, resolved through \`@/ui\` re-exports and relative co-located imports. Filename string matches are no longer used.

**Scope of the claim:** this is a primitive-level design-system catalog (tokens, layout/input/feedback primitives and a handful of shared widgets). It is **not** a claim that all ${rows.length} audited modules are tested or visually reviewed. "Story: yes" means a story imports and renders that export, nothing more.

## Checklist

| Rule | Gate |
|---|---|
| No hardcoded colour outside \`src/ui/palette.ts\` | fails |
| No legacy 8px/12px radius (terminal uses 2px) | fails |
| No Mantine \`styles\` prop | fails |
| No React import | fails |
| Has a Storybook story (imported export name) | reported |
| Has a co-located test | reported |

## Status

- Audited modules exercised by a story: **${withStory}/${rows.length}**
- Modules with a co-located test: **${withTest}/${rows.length}**
- Violations: **${violations.length}**

${violations.length ? "### Violations\n\n" + violations.map((v) => `- ${v}`).join("\n") : "No rule violations."}

## Inventory

| Component | Story | Story imports | Test | Hex | Legacy radius |
|---|---|---|---|---|---|
${table}
`;

writeFileSync(join(ROOT, "docs/COMPONENT_AUDIT.md"), doc);
console.log(
  `component-audit: ${rows.length} modules, ${allStories.length} story files (${centralizedStories.length} centralized / ${colocatedStories.length} co-located), ${storyEntries} story entries, ${withStory} modules with story, ${withTest} with test, ${violations.length} violations`,
);
for (const v of violations) console.log("  " + v);
process.exit(violations.length ? 1 : 0);
