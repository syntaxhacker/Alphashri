// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

// No exceptions: Mantine `styles={{...}}` props are always dropped by the MUI wrappers.
const ALLOWLIST = new Set<string>();

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

describe("UI guard — Mantine props", () => {
  it("no `styles={{...}}` (Mantine-only) prop remains in src", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (rel.includes(".test.") || rel.includes(".stories.")) continue;
      if (ALLOWLIST.has(rel)) continue;
      if (/styles=\{\{/.test(readFileSync(file, "utf8"))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
