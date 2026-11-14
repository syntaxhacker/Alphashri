// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import type { JSX } from "solid-js";
import { render, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import * as Icons from "./Icons";
import { Icon } from "./Icons";

/**
 * Regression guard: ICON_NODES is keyed in camelCase ("alertCircle") while most
 * aliases pass a kebab-case name ("alert-circle"). Before the kebab -> camelCase
 * fallback in `Icon`, every such alias rendered an empty <svg> and icons were
 * invisible across the app.
 */

const DRAWABLE = "path, circle, rect, line, polyline, polygon, ellipse";

const drawableChildren = (svg: SVGElement) => svg.querySelectorAll(DRAWABLE).length;

/**
 * Aliases are discovered from the module's own exports so a newly added
 * `Icon*` alias with no matching node fails here instead of shipping blank.
 */
const aliasEntries = Object.entries(Icons).filter(
  ([exportName, value]) => exportName.startsWith("Icon") && exportName !== "Icon" && typeof value === "function",
) as Array<[string, (props: Icons.IconProps) => JSX.Element]>;

/** The bare base component: needs a `name` prop, so it is asserted explicitly below. */
const baseExport = Icons.Icon;

describe("Icons module exports", () => {
  it("exports the base Icon component plus the alias components", () => {
    expect(typeof baseExport).toBe("function");
    // Guard against the export scan silently finding nothing (e.g. a rename).
    expect(aliasEntries.length).toBeGreaterThanOrEqual(81);
  });

  it("exports no duplicate alias names", () => {
    const names = aliasEntries.map(([name]) => name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("every Icon* alias renders drawing nodes", () => {
  it.each(aliasEntries)("%s renders a non-empty <svg>", (_exportName, Alias) => {
    const { container } = render(() => <Alias />);
    const svg = container.querySelector("svg");

    expect(svg).not.toBeNull();
    expect(drawableChildren(svg as SVGElement)).toBeGreaterThan(0);
    cleanup();
  });
});

describe("kebab-case name resolution (regression)", () => {
  it("resolves the kebab-case 'alert-circle' name to a node", () => {
    const { container } = render(() => <Icon name="alert-circle" />);
    const svg = container.querySelector("svg") as SVGElement;

    expect(svg).not.toBeNull();
    expect(drawableChildren(svg)).toBeGreaterThan(0);
  });

  it("keeps resolving camelCase names that already worked (exact key path)", () => {
    const { container } = render(() => <Icon name="alertCircle" />);
    expect(drawableChildren(container.querySelector("svg") as SVGElement)).toBeGreaterThan(0);

    cleanup();
    const camelAlias = render(() => <Icon name="plugConnected" />);
    expect(
      drawableChildren(camelAlias.container.querySelector("svg") as SVGElement),
    ).toBeGreaterThan(0);
  });

  it("maps every kebab-case alias name onto a node", () => {
    // Names are read off the rendered svg's data-testid (`icon-<name>`), which
    // is derived from the `name` prop each alias passes to <Icon>.
    const kebabNames = aliasEntries
      .map(([, Alias]) => render(() => <Alias />).container.querySelector("svg")?.getAttribute("data-testid"))
      .filter((id): id is string => Boolean(id) && (id as string).includes("-"))
      .map((id) => id.replace(/^icon-/, ""));

    expect(kebabNames.length).toBeGreaterThan(0);

    for (const name of kebabNames) {
      cleanup();
      const { container } = render(() => <Icon name={name} />);
      expect(drawableChildren(container.querySelector("svg") as SVGElement), name).toBeGreaterThan(0);
    }
  });

  it("does not invent nodes for truly unknown names", () => {
    const { container } = render(() => <Icon name="definitely-not-an-icon" />);
    expect(drawableChildren(container.querySelector("svg") as SVGElement)).toBe(0);
  });
});

describe("deliberately empty renders (asserted, not skipped)", () => {
  it("<Icon /> without a name renders an empty <svg> on purpose (base component needs a name)", () => {
    const { container } = render(() => <Icon name="" />);
    const svg = container.querySelector("svg") as SVGElement;

    expect(svg).not.toBeNull();
    expect(drawableChildren(svg)).toBe(0);
  });
});
