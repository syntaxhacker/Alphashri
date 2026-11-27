// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import * as screenerIcons from "./icons";
import * as canonicalIcons from "@/ui/icons";
import type { TablerIconProps } from "./icons";

afterEach(cleanup);

type IconComponent = (props: TablerIconProps) => JSX.Element;
type ScreenerIconName = keyof typeof screenerIcons;

/** Every runtime export of the module, so a newly added icon is covered too. */
const iconNames = (Object.keys(screenerIcons) as ScreenerIconName[])
  .filter((name) => typeof screenerIcons[name] === "function")
  .sort();

function renderIcon(Icon: IconComponent, props: TablerIconProps = {}): SVGSVGElement {
  const { container } = render(() => <Icon {...props} />);
  const svg = container.querySelector("svg");
  expect(svg).not.toBeNull();
  return svg as SVGSVGElement;
}

function paintedPathData(svg: SVGSVGElement): string[] {
  const paths = Array.from(svg.querySelectorAll("path"));
  expect(paths.length).toBeGreaterThan(0);
  const data = paths.map((path) => path.getAttribute("d") ?? "");
  expect(data.every((d) => d.length > 0)).toBe(true);
  return data;
}

const SVG_ATTRS = [
  "viewBox",
  "width",
  "height",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
] as const;

/** Compare visible paint instructions, not DOM node count: `@/ui/icons`
 * merges all subpaths into a single `<path>` because `d` is self-delimiting. */
function fingerprint(svg: SVGSVGElement) {
  return {
    attrs: Object.fromEntries(SVG_ATTRS.map((attr) => [attr, svg.getAttribute(attr)])),
    paint: paintedPathData(svg).join(""),
  };
}

/** Names present in both this module and the canonical `@/ui/icons` module. */
const duplicates = [
  "IconAlertCircle",
  "IconBellRinging",
  "IconChartBar",
  "IconChevronDown",
  "IconChevronLeft",
  "IconChevronRight",
  "IconClock",
  "IconRefresh",
  "IconTable",
  "IconUsers",
  "IconX",
] as const;

/** `IconClock` is a thin adapter (it maps `className`), the rest are direct
 * re-exports of the canonical component object. */
const directReExports = duplicates.filter((name) => name !== "IconClock");

describe("screener icons", () => {
  it("exposes 26 icon components", () => {
    expect(iconNames).toHaveLength(26);
  });

  it.each(iconNames)("%s paints an SVG with path data", (name) => {
    const svg = renderIcon(screenerIcons[name] as IconComponent);
    paintedPathData(svg);
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("fill")).toBe("none");
  });

  it.each(duplicates)("%s matches the canonical @/ui/icons node", (name) => {
    const local = fingerprint(renderIcon(screenerIcons[name] as IconComponent));
    const canonical = fingerprint(renderIcon(canonicalIcons[name] as unknown as IconComponent));
    expect(local).toEqual(canonical);
  });

  it.each(directReExports)("%s is the canonical component (no local copy)", (name) => {
    expect(screenerIcons[name]).toBe(canonicalIcons[name]);
  });

  it("IconClock still forwards className to the SVG class attribute", () => {
    const svg = renderIcon(screenerIcons.IconClock, { className: "text-fin-text-muted" });
    expect(svg.getAttribute("class")).toBe("text-fin-text-muted");
  });
});
