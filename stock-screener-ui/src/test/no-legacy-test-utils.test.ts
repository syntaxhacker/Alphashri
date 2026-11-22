// @vitest-environment node
/**
 * The legacy `src/test/test-utils.tsx` re-export shim was removed: component
 * tests now import the one canonical render helper. This guard stops the shim
 * from reappearing (in any common JS/TS form) and stops source files from
 * pointing at the old module path again.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const GUARD = relative(SRC, fileURLToPath(import.meta.url)).split("\\").join("/");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Module specifiers that resolve to the legacy shim, with or without an extension. */
const LEGACY_MODULE = /(?:^|\/)test\/test-utils(?:\.[cm]?[jt]sx?)?$/;

/** Specifiers of `from "…"`, `import("…")`, `require("…")`, `mock("…")`. */
function specifiers(source: string): { specifier: string; index: number }[] {
  const pattern = /\b(?:from|import|require|mock)\s*\(?\s*["']([^"']+)["']/g;
  const found: { specifier: string; index: number }[] = [];
  for (const match of source.matchAll(pattern)) {
    found.push({ specifier: match[1], index: match.index ?? 0 });
  }
  return found;
}

describe("no legacy test/test-utils shim", () => {
  it("the shim file does not exist under src/test", () => {
    const candidates = [
      "test-utils.ts",
      "test-utils.tsx",
      "test-utils.js",
      "test-utils.jsx",
      "test-utils.mjs",
      "test-utils.cjs",
      "test-utils/index.ts",
      "test-utils/index.tsx",
      "test-utils/index.js",
    ].map((name) => join(SRC, "test", name));

    const existing = candidates
      .filter((file) => existsSync(file))
      .map((file) => relative(SRC, file).split("\\").join("/"));

    expect(existing, `\n${existing.join("\n")}\n`).toEqual([]);
  });

  it("no source file imports the legacy module path", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split("\\").join("/");
      if (rel === GUARD) continue; // this guard quotes the path in its own patterns
      const source = readFileSync(file, "utf8");
      for (const { specifier, index } of specifiers(source)) {
        if (LEGACY_MODULE.test(specifier)) {
          const line = source.slice(0, index).split("\n").length;
          offenders.push(`${rel}:${line} imports "${specifier}"`);
        }
      }
    }

    expect(offenders, `\n${offenders.join("\n")}\n`).toEqual([]);
  });
});
