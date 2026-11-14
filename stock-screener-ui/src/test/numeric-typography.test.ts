// @vitest-environment node
/**
 * `tabular-nums` alone does not make a number line up — the glyphs must also be
 * monospaced, otherwise a proportional face still shifts every time a digit
 * changes width. The codebase had ~160 sites using tabular-nums without
 * font-mono, so the same numeric column rendered different widths on adjacent
 * pages.
 *
 * Fix with `<NumCell>` from `@/components/common/tableCells`, or add `font-mono`
 * alongside `tabular-nums`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/**
 * Files still to migrate. May only shrink — every entry is known debt.
 */
const ALLOWLIST = new Set([
  "pages/report/ReportDeliveryStrip.tsx",
  "pages/report/EventWatch.tsx",
  "pages/report/NiftyWallsCard.tsx",
  "pages/report/NiftyDepthMap.tsx",
  "components/screener/DashboardView.tsx",
  // The kit itself sets font-mono on a neighbouring class name.
  "components/common/tableCells.tsx",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

interface Offender {
  file: string;
  line: number;
}

/** A className that says tabular-nums but not font-mono, in the same string. */
export function findTabularWithoutMono(file: string, source: string): Offender[] {
  const offenders: Offender[] = [];
  const lines = source.split("\n");
  lines.forEach((text, index) => {
    for (const match of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const classes = (match[1] ?? match[2] ?? "").toString();
      if (classes.includes("tabular-nums") && !classes.includes("font-mono")) {
        offenders.push({ file, line: index + 1 });
      }
    }
  });
  return offenders;
}

describe("numeric typography", () => {
  it("detects tabular-nums without font-mono", () => {
    const offenders = findTabularWithoutMono("fixture.tsx", [
      'const a = <Text className="tabular-nums" />;',
      'const b = <Text className="font-mono tabular-nums" />;',
      "const c = <Text className={`text-right tabular-nums`} />;",
    ].join("\n"));
    expect(offenders.map((o) => o.line)).toEqual([1, 3]);
  });

  it("no table renders tabular numbers in a proportional face", () => {
    const offenders: Offender[] = [];
    for (const path of walk(SRC)) {
      if (/\.test\.|\.stories\./.test(path)) continue;
      const rel = relative(SRC, path);
      if (ALLOWLIST.has(rel)) continue;
      offenders.push(...findTabularWithoutMono(rel, readFileSync(path, "utf8")));
    }
    const report = offenders.map((o) => `${o.file}:${o.line}`).join("\n");
    expect(offenders, `\n${report}\n\nUse <NumCell> or add font-mono.`).toEqual([]);
  });
});
