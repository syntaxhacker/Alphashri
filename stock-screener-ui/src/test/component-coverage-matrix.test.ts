// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const AUDIT_PATH = join(ROOT, "docs", "COMPONENT_AUDIT.md");
const EXCEPTIONS_PATH = join(ROOT, "docs", "COMPONENT_AUDIT_EXCEPTIONS.md");

// Floored from the generated audit's measured baseline; raise only, never lower.
const STORY_BASELINE = 88;

type AuditRow = { module: string; storied: boolean; tested: boolean };
type Ratio = { covered: number; total: number };
type Story = { file: string; text: string };

type EvaluationInput = {
  auditMarkdown: string;
  exceptionsMarkdown: string;
  inventory: string[];
  stories: Story[];
  hasTest: (module: string) => boolean;
  storyBaseline: number;
};

type Evaluation = {
  violations: string[];
  counts: { audited: number; tested: number; storied: number; exceptions: number; unaccounted: number };
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function parseRatio(markdown: string, label: string): Ratio {
  const line = markdown.split("\n").find((candidate) => candidate.includes(label));
  const match = line?.match(/\*\*(\d+)\/(\d+)\*\*/);
  // A missing status line must never turn into a silent pass.
  if (!match) throw new Error(`audit status line "${label}" is missing or malformed`);
  return { covered: Number(match[1]), total: Number(match[2]) };
}

function parseAudit(markdown: string): { rows: AuditRow[]; declaredStories: Ratio; declaredTests: Ratio } {
  const inventoryAt = markdown.indexOf("## Inventory");
  if (inventoryAt < 0) throw new Error("audit has no ## Inventory section");
  const rows: AuditRow[] = [];
  for (const line of markdown.slice(inventoryAt).split("\n")) {
    const match = line.match(/^\|\s*`([^`]+)`\s*\|\s*(yes|—)\s*\|[^|]*\|\s*(yes|—)\s*\|/);
    if (!match) continue;
    rows.push({ module: match[1], storied: match[2] === "yes", tested: match[3] === "yes" });
  }
  if (rows.length === 0) throw new Error("audit inventory parsed to zero rows — parser or report changed");
  if (new Set(rows.map((row) => row.module)).size !== rows.length) {
    throw new Error("audit inventory has duplicate module rows");
  }
  return {
    rows,
    declaredStories: parseRatio(markdown, "Audited modules exercised by a story"),
    declaredTests: parseRatio(markdown, "Modules with a co-located test"),
  };
}

function parseExceptions(markdown: string): Map<string, string> {
  const reasons = new Map<string, string>();
  for (const line of markdown.split("\n")) {
    const match = line.match(/^\|\s*`([^`]+)`\s*\|\s*([^|]*)\|/);
    if (!match) continue;
    reasons.set(match[1], match[2].trim());
  }
  return reasons;
}

function baseName(module: string): string {
  return module.slice(module.lastIndexOf("/") + 1, -4);
}

function hasStoryEvidence(module: string, stories: Story[]): boolean {
  const base = baseName(module);
  return stories.some(
    (story) =>
      story.file.slice(story.file.lastIndexOf("/") + 1, -".stories.tsx".length) === base ||
      story.text.includes(`<${base}`),
  );
}

function evaluate(input: EvaluationInput): Evaluation {
  const audit = parseAudit(input.auditMarkdown);
  const exceptions = parseExceptions(input.exceptionsMarkdown);
  const audited = new Set(audit.rows.map((row) => row.module));
  const testedRows = audit.rows.filter((row) => row.tested);
  const storiedRows = audit.rows.filter((row) => row.storied);
  const violations: string[] = [];

  const consistent =
    audit.declaredTests.total === audit.rows.length &&
    audit.declaredTests.covered === testedRows.length &&
    audit.declaredStories.total === audit.rows.length &&
    audit.declaredStories.covered === storiedRows.length;
  if (!consistent) {
    violations.push(
      `audit status counts (${audit.declaredTests.covered}/${audit.declaredTests.total} tested, ` +
        `${audit.declaredStories.covered}/${audit.declaredStories.total} storied) disagree with the inventory table ` +
        `(${testedRows.length}/${audit.rows.length} tested, ${storiedRows.length}/${audit.rows.length} storied)`,
    );
  }

  for (const row of audit.rows) {
    if (!row.tested) violations.push(`${row.module}: audited module has no co-located test`);
    else if (!input.hasTest(row.module)) {
      violations.push(`${row.module}: audit claims a co-located test but no sibling *.test.tsx imports it`);
    }
  }

  for (const row of audit.rows.filter((candidate) => !candidate.tested)) {
    if (!exceptions.has(row.module)) {
      violations.push(`${row.module}: untested module is not documented in COMPONENT_AUDIT_EXCEPTIONS.md`);
    }
  }

  if (storiedRows.length < input.storyBaseline) {
    violations.push(
      `story coverage ${storiedRows.length}/${audit.rows.length} is below the ` +
        `${input.storyBaseline}/${audit.declaredStories.total} baseline`,
    );
  }

  for (const row of audit.rows.filter((candidate) => !candidate.storied)) {
    const why = exceptions.get(row.module);
    if (!why && !hasStoryEvidence(row.module, input.stories)) {
      violations.push(
        `${row.module}: unstoried module has neither a documented composition-only exception ` +
          `nor a story file that exercises it`,
      );
    }
  }

  const unaccounted = input.inventory.filter((module) => !audited.has(module) && !exceptions.has(module));
  for (const module of unaccounted) {
    if (!input.hasTest(module) || !hasStoryEvidence(module, input.stories)) {
      violations.push(
        `${module}: untested/unstoried module is listed neither in COMPONENT_AUDIT.md nor in COMPONENT_AUDIT_EXCEPTIONS.md`,
      );
    }
  }

  for (const [module, why] of exceptions) {
    if (!audited.has(module)) violations.push(`${module}: exception names a module absent from the audit`);
    if (!why) violations.push(`${module}: exception has no composition-only justification`);
  }

  return {
    violations,
    counts: {
      audited: audit.rows.length,
      tested: testedRows.length,
      storied: storiedRows.length,
      exceptions: exceptions.size,
      unaccounted: unaccounted.length,
    },
  };
}

function diskHasTest(module: string): boolean {
  const absolute = join(SRC, module);
  const base = baseName(module);
  return readdirSync(dirname(absolute)).some(
    (name) => name.endsWith(".test.tsx") && readFileSync(join(dirname(absolute), name), "utf8").includes(base),
  );
}

function sourceInventory(): string[] {
  return ["ui", "components/common"]
    .flatMap((group) => walk(join(SRC, group)))
    .filter((file) => file.endsWith(".tsx") && !/\.(test|stories|spec)\./.test(file))
    .map((file) => relative(SRC, file).split(sep).join("/"));
}

describe("component coverage matrix guard", () => {
  const result = evaluate({
    auditMarkdown: readFileSync(AUDIT_PATH, "utf8"),
    exceptionsMarkdown: readFileSync(EXCEPTIONS_PATH, "utf8"),
    inventory: sourceInventory(),
    stories: walk(SRC)
      .filter((file) => file.endsWith(".stories.tsx"))
      .map((file) => ({ file, text: readFileSync(file, "utf8") })),
    hasTest: diskHasTest,
    storyBaseline: STORY_BASELINE,
  });

  it("holds the measured floors without hardcoding the row list", () => {
    expect(result.counts.audited, "audited scope must not shrink below 100 modules").toBeGreaterThanOrEqual(100);
    expect(result.counts.tested, "co-located tests must stay at 100%").toBe(result.counts.audited);
    expect(result.counts.storied, "story coverage must not drop below the 88-module baseline").toBeGreaterThanOrEqual(
      STORY_BASELINE,
    );
    expect(result.counts.unaccounted, "every source module must be accounted for").toBe(0);
  });

  it("keeps every gap either tested, storied or documented", () => {
    expect(result.violations, result.violations.join("\n")).toEqual([]);
  });
});

describe("component coverage matrix guard self-test (synthetic markdown)", () => {
  const auditMarkdown = `# Component audit

## Status

- Audited modules exercised by a story: **2/3**
- Modules with a co-located test: **2/3**
- Violations: **0**

## Inventory

| Component | Story | Story imports | Test | Hex | Legacy radius |
|---|---|---|---|---|---|
| \`ui/demo/Storied.tsx\` | yes | \`Storied\` | yes | 0 | 0 |
| \`ui/demo/Documented.tsx\` | — | — | yes | 0 | 0 |
| \`ui/demo/Missing.tsx\` | yes | \`Missing\` | — | 0 | 0 |
`;
  const exceptionsMarkdown = `# Component audit exceptions

| Module | Why no standalone story | Owning story / family |
|---|---|---|
| \`ui/demo/Documented.tsx\` | Composition-only wrapper with no independent visual state. | \`ui/demo/Storied.test.tsx\` |
`;
  const inventory = ["ui/demo/Storied.tsx", "ui/demo/Documented.tsx", "ui/demo/Missing.tsx"];
  const synthetic: EvaluationInput = {
    auditMarkdown,
    exceptionsMarkdown,
    inventory,
    stories: [],
    hasTest: (module) => module !== "ui/demo/Missing.tsx",
    storyBaseline: 2,
  };

  it("fails when a table row has no co-located test", () => {
    const result = evaluate(synthetic);
    expect(result.violations, result.violations.join("\n")).toContain(
      "ui/demo/Missing.tsx: audited module has no co-located test",
    );
  });

  it("fails when story coverage drops below the baseline", () => {
    const dropped = auditMarkdown
      .replace("**2/3**\n- Modules", "**1/3**\n- Modules")
      .replace("| `ui/demo/Storied.tsx` | yes |", "| `ui/demo/Storied.tsx` | — |");
    const result = evaluate({ ...synthetic, auditMarkdown: dropped });
    expect(result.violations, result.violations.join("\n")).toContain(
      "story coverage 1/3 is below the 2/3 baseline",
    );
  });

  it("fails when an untested, unstoried module is absent from both documents", () => {
    const result = evaluate({ ...synthetic, inventory: [...inventory, "ui/demo/Ghost.tsx"] });
    expect(result.violations, result.violations.join("\n")).toContain(
      "ui/demo/Ghost.tsx: untested/unstoried module is listed neither in COMPONENT_AUDIT.md nor in COMPONENT_AUDIT_EXCEPTIONS.md",
    );
  });
});
