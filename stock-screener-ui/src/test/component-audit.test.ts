// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const GROUPS = ["ui", "components/common"];

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

const targets = GROUPS.flatMap((group) => walk(join(SRC, group))).filter(
  (file) => file.endsWith(".tsx") && !/\.(test|stories)\./.test(file) && !file.endsWith("palette.ts"),
);

describe("component audit", () => {
  it("every shared component follows the terminal rules", () => {
    const violations: string[] = [];
    for (const file of targets) {
      const rel = file.slice(SRC.length + 1);
      const text = readFileSync(file, "utf8");
      const hexes = [...new Set(text.match(/#[0-9a-fA-F]{6}\b/g) ?? [])];
      const legacy = [...new Set(text.match(/rounded-\[(8|12)px\]|"border-radius":\s*"(8|12)px"/g) ?? [])];
      const mantine = text.includes("styles={{");
      const react = /from "react(-dom)?"/.test(text);
      if (hexes.length) violations.push(`${rel}: hardcoded ${hexes.join(", ")}`);
      if (legacy.length) violations.push(`${rel}: legacy radius ${legacy.join(", ")}`);
      if (mantine) violations.push(`${rel}: Mantine styles prop`);
      if (react) violations.push(`${rel}: react import`);
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("the audit report covers every shared component", () => {
    const doc = readFileSync(join(SRC, "..", "docs", "COMPONENT_AUDIT.md"), "utf8");
    for (const file of targets) {
      expect(doc, `missing ${file}`).toContain(file.slice(SRC.length + 1));
    }
  });
});
