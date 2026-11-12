// @vitest-environment node
/**
 * React-era guard: fails if any `src/**` module still imports a React-only
 * package. This is a source-hygiene check, so it reads files from disk with
 * `node:fs` instead of importing them (importing would execute the very
 * modules we are trying to police).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Resolved from this file (`src/test/no-react.test.ts`) -> `src/`, never from
// `process.cwd()`, so the guard behaves the same under any vitest invocation.
const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));
// The guard's own fixtures contain banned specifiers as string literals, so it
// must not scan itself.
const SELF = fileURLToPath(import.meta.url);

/**
 * Per-file exceptions, as paths relative to `src/`. This list may only SHRINK:
 * every entry is a known piece of migration debt, and anything not listed here
 * fails the guard.
 */
const ALLOWLIST: string[] = [
  "pages/report/DailyReportPage.test.tsx",
  "pages/report/EventWatch.test.tsx",
  "pages/report/NiftyChartPanel.test.tsx",
  "pages/report/NiftyPositionsDrawer.test.tsx",
];

/**
 * Packages banned once the SolidJS migration is complete. `@storybook/*` is
 * matched as a prefix so every addon/preset variant is covered.
 */
const BANNED_MODULES = [
  "react-dom",
  "react-router-dom",
  "react-redux",
  "@testing-library/react",
  "@testing-library/user-event",
  "@tabler/icons-react",
  "echarts-for-react",
  "react-markdown",
  "notistack",
  "react",
  "@storybook/",
];

// Alternation ordered longest-first so prefix rules (@storybook/) win over
// shorter ones; `[^"']+` lets `@storybook/addon-docs` and friends through.
const MODULE_PATTERN = BANNED_MODULES.slice()
  .sort((a, b) => b.length - a.length)
  .map((m) => (m.endsWith("/") ? `${m.replace(/[/]/g, "\\/")}[^"']+` : `${m.replace(/[/]/g, "\\/")}`))
  .join("|");

// Only real module-specifier positions count: `from "<mod>"`, `require("<mod>")`,
// dynamic `import("<mod>")`, and side-effect `import "<mod>"`. A bare `react`
// substring (e.g. `reactive`, `reactivity`, `./react-helpers`) never matches
// because the closing quote must immediately follow the module name.
const IMPORT_PATTERN = new RegExp(
  `(?:\\bfrom\\s*|\\brequire\\s*\\(\\s*|\\bimport\\s*\\(\\s*|\\bimport\\s+)["'](${MODULE_PATTERN})["']`,
  "g",
);

interface Offender {
  file: string;
  line: number;
  text: string;
  module: string;
}

/** Returns the banned imports found in one file's source text. */
export function scanSource(source: string): Array<{ line: number; text: string; module: string }> {
  const hits: Array<{ line: number; text: string; module: string }> = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    IMPORT_PATTERN.lastIndex = 0;
    const match = IMPORT_PATTERN.exec(line);
    if (!match) continue;
    hits.push({ line: i + 1, text: line.trim(), module: match[1] });
  }
  return hits;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.stories\./.test(entry)) out.push(full);
  }
  return out;
}

function findOffenders(): Offender[] {
  const offenders: Offender[] = [];
  for (const file of walk(SRC_DIR)) {
    if (file === SELF) continue;
    const rel = relative(SRC_DIR, file);
    if (ALLOWLIST.includes(rel)) continue;
    for (const hit of scanSource(readFileSync(file, "utf8"))) {
      offenders.push({ file: rel, ...hit });
    }
  }
  return offenders;
}

describe("no-react guard — SolidJS migration", () => {
  it("matches real React import forms but not unrelated `react` substrings", () => {
    const positives = [
      'import { useState } from "react";',
      "import { render } from 'react-dom';",
      'import { useNavigate } from "react-router-dom";',
      'import { Provider } from "react-redux";',
      'import { render } from "@testing-library/react";',
      'import userEvent from "@testing-library/user-event";',
      'import { IconX } from "@tabler/icons-react";',
      'import { enqueueSnackbar } from "notistack";',
      'import ReactECharts from "echarts-for-react";',
      'import Markdown from "react-markdown";',
      'import "@storybook/addon-docs";',
      'import type { Meta } from "@storybook/react-vite";',
      'const React = require("react");',
      'const ReactDOM = require("react-dom");',
      'const mod = await import("react");',
    ];
    for (const source of positives) {
      expect(scanSource(source), `should flag: ${source}`).toHaveLength(1);
    }

    const negatives = [
      'import { createSignal } from "solid-js";',
      'import { reactive } from "./reactive-store";',
      'const reactivity = "react is not imported here";',
      '// we removed react from this file',
      'import { fromReactive } from "./utils/reactive";',
      'import { x } from "react-query-shim";',
      'import { y } from "./components/react-helpers";',
      'const mapper = { reactive: true, reactdom: false };',
    ];
    for (const source of negatives) {
      expect(scanSource(source), `should NOT flag: ${source}`).toHaveLength(0);
    }
  });

  it("has no React imports anywhere in src/**/*.{ts,tsx}", () => {
    const offenders = findOffenders();
    const report = offenders
      .map((o) => `  ${o.file}:${o.line}  [${o.module}]  ${o.text}`)
      .join("\n");
    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `React-era imports found in src/ (migrate to solid-js / @solidjs/router / @solidjs/testing-library):\n${report}\n`,
    ).toEqual([]);
  });
});
