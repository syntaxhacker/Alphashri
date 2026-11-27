// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TYPES_PATH = fileURLToPath(new URL("../ui/types.ts", import.meta.url));

type Rule =
  | { kind: "prop"; category: string; sections: string[]; props: string[] }
  | { kind: "void-onclick"; category: string; sections: string[] };

/**
 * The removed props are only forbidden on the interfaces that used to advertise
 * them. `variant`, `color`, `loop`, `keepMounted`, `loading` and `onClick` are
 * legitimate on other UI types, so a file-wide grep would false-positive.
 */
const RULES: Rule[] = [
  {
    kind: "prop",
    category: "InputProps on select/input types",
    sections: [
      "UIInputCompatProps",
      "UIInputWrapperProps",
      "UITextInputProps",
      "UINumberInputProps",
      "UISelectProps",
      "UIMultiSelectProps",
      "UITextareaProps",
      "UIPasswordInputProps",
    ],
    props: ["InputProps"],
  },
  {
    kind: "prop",
    category: "Tooltip withinPortal",
    sections: ["UITooltipProps"],
    props: ["withinPortal"],
  },
  {
    kind: "prop",
    category: "NumberInput styles/loading/variant",
    sections: ["UIInputCompatProps", "UIInputWrapperProps", "UINumberInputProps"],
    props: ["styles", "loading", "variant"],
  },
  {
    kind: "prop",
    category: "Modal centered/transitionProps",
    sections: ["UIModalProps"],
    props: ["centered", "transitionProps"],
  },
  {
    kind: "prop",
    category: "Popover middlewares/keepMounted",
    sections: ["UIPopoverProps"],
    props: ["middlewares", "keepMounted"],
  },
  {
    kind: "prop",
    category: "Tabs variant/color/activateOnFocus/loop",
    sections: ["UITabsProps"],
    props: ["variant", "color", "activateOnFocus", "loop"],
  },
  {
    kind: "prop",
    category: "Menu renderTarget",
    sections: ["UIMenuProps"],
    props: ["renderTarget"],
  },
  {
    kind: "void-onclick",
    category: "void onClick overrides on NavLink/MenuItem/CloseButton",
    sections: ["UINavLinkProps", "UIMenuItemProps", "UICloseButtonProps"],
  },
];

const ALL_SECTIONS = [...new Set(RULES.flatMap((rule) => rule.sections))];

/** Blank comments while preserving offsets and string literals (prop keys can be quoted). */
function stripComments(source: string): string {
  const chars = source.split("");
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i++;
      while (i < chars.length && chars[i] !== ch) {
        i += chars[i] === "\\" ? 2 : 1;
      }
      if (i < chars.length) i++;
      continue;
    }
    if (ch === "/" && chars[i + 1] === "/") {
      while (i < chars.length && chars[i] !== "\n") chars[i++] = " ";
      continue;
    }
    if (ch === "/" && chars[i + 1] === "*") {
      chars[i++] = " ";
      chars[i++] = " ";
      while (i < chars.length && !(chars[i] === "*" && chars[i + 1] === "/")) {
        if (chars[i] !== "\n") chars[i] = " ";
        i++;
      }
      if (i < chars.length) {
        chars[i++] = " ";
        chars[i++] = " ";
      }
      continue;
    }
    i++;
  }
  return chars.join("");
}

/** Extract each `export interface X { ... }` body by matching braces, ignoring quoted strings. */
function parseSections(source: string): Map<string, string> {
  const sections = new Map<string, string>();
  const header = /\bexport interface\s+(\w+)[^{]*\{/g;
  let match: RegExpExecArray | null;
  while ((match = header.exec(source))) {
    let depth = 1;
    let i = header.lastIndex;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === '"' || ch === "'" || ch === "`") {
        i++;
        while (i < source.length && source[i] !== ch) {
          i += source[i] === "\\" ? 2 : 1;
        }
        if (i < source.length) i++;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    sections.set(match[1], source.slice(header.lastIndex, i - 1));
    header.lastIndex = i;
  }
  return sections;
}

function declaresProp(body: string, prop: string): boolean {
  const name = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*(?:"${name}"|'${name}'|${name})\\s*\\??\\s*:`, "m").test(body);
}

function findViolations(source: string, rules: readonly Rule[]): string[] {
  const sections = parseSections(stripComments(source));
  const violations: string[] = [];
  for (const rule of rules) {
    for (const section of rule.sections) {
      const body = sections.get(section);
      if (body === undefined) {
        violations.push(`${section}: missing interface section (${rule.category})`);
        continue;
      }
      // A local onClick on these three types replaces the event-forwarding base
      // signature with the removed no-argument (void) one.
      const props = rule.kind === "prop" ? rule.props : ["onClick"];
      for (const prop of props) {
        if (declaresProp(body, prop)) {
          violations.push(`${section}.${prop}: removed public prop (${rule.category})`);
        }
      }
    }
  }
  return violations;
}

function syntheticSource(
  overrides: Record<string, string[]> = {},
  extraSections: string[] = [],
): string {
  const names = [...new Set([...ALL_SECTIONS, ...extraSections])];
  return names
    .map((name) => `export interface ${name} extends UIBaseProps {\n${(overrides[name] ?? []).join("\n")}\n}\n`)
    .join("\n");
}

describe("public API surface — removed swallowed props", () => {
  it("src/ui/types.ts keeps every removed prop out of the public sections", () => {
    expect(findViolations(readFileSync(TYPES_PATH, "utf8"), RULES)).toEqual([]);
  });
});

describe("public API surface guard — self-tests", () => {
  it("accepts a clean synthetic surface", () => {
    expect(findViolations(syntheticSource(), RULES)).toEqual([]);
  });

  it("flags a quoted-key reintroduction", () => {
    const violations = findViolations(
      syntheticSource({ UITooltipProps: ['  "withinPortal"?: boolean;'] }),
      RULES,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("UITooltipProps.withinPortal");
  });

  it("ignores the same prop names on unrelated components", () => {
    // variant/loading belong on Button, keepMounted on TabPanel and loop on Menu.
    const source = syntheticSource(
      {
        UIButtonProps: ["  variant?: string;", "  loading?: boolean;"],
        UITabsPanelProps: ["  keepMounted?: boolean;"],
        UIMenuProps: ["  loop?: boolean;"],
      },
      ["UIButtonProps", "UITabsPanelProps"],
    );
    expect(findViolations(source, RULES)).toEqual([]);
  });

  for (const rule of RULES) {
    for (const section of rule.sections) {
      const props = rule.kind === "prop" ? rule.props : ["onClick"];
      for (const prop of props) {
        it(`flags ${section}.${prop} (${rule.category})`, () => {
          const line = rule.kind === "void-onclick" ? "  onClick?: () => void;" : `  ${prop}?: unknown;`;
          const violations = findViolations(syntheticSource({ [section]: [line] }), RULES);
          expect(violations).toHaveLength(1);
          expect(violations[0]).toContain(`${section}.${prop}`);
        });
      }
    }
  }
});
