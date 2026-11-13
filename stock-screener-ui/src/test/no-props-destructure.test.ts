// @vitest-environment node
/**
 * Solid component props are getters. Destructuring them reads each value once
 * at creation, so the component never reacts again — the panel freezes on its
 * first payload and no test that only asserts the initial render notices.
 *
 * This guards the two shapes at the component boundary:
 *   function C({ a, b }: CProps) { ... }
 *   const { a, b } = props;
 *
 * `const { a } = props` inside a helper that is *not* a component is allowed by
 * design only where the helper re-reads on every call; those are listed below
 * with a reason, and the list may only shrink.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/**
 * Files where `const {...} = props` sits in a non-component helper that is
 * invoked per render/patch rather than once at mount. Each entry needs a reason.
 */
const ALLOWED_HELPER_DESTRUCTURE = new Map<string, string>([
  ["components/screener/CorrelationChart.tsx", "inside buildOption(), re-run by the chart effect"],
  ["components/strategies/strategyDefaults.ts", "pure config mapper, not a component"],
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/** `function Name({ a, b }: Props)` — a component whose props are destructured. */
const DESTRUCTURED_PARAM = /(?:export\s+)?function\s+([A-Z]\w*)\s*\(\s*\{/g;
/** `const { a, b } = props` anywhere in the file. */
const PROPS_ALIAS = /const\s*\{[^}]+\}\s*=\s*props\b/g;

describe("Solid props are never destructured", () => {
  it("no component destructures its props parameter", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (/\.test\.|\.stories\./.test(file)) continue;
      const rel = relative(SRC, file);
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(DESTRUCTURED_PARAM)) {
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${rel}:${line} — function ${match[1]}({ ... })`);
      }
    }
    expect(offenders, `\n${offenders.join("\n")}\n`).toEqual([]);
  });

  it("no `const { ... } = props` outside the documented helper allowlist", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (/\.test\.|\.stories\./.test(file)) continue;
      const rel = relative(SRC, file);
      if (ALLOWED_HELPER_DESTRUCTURE.has(rel)) continue;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(PROPS_ALIAS)) {
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${rel}:${line} — const { ... } = props`);
      }
    }
    expect(offenders, `\n${offenders.join("\n")}\n`).toEqual([]);
  });
});
