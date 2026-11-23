// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
import { sxTheme } from "../sxTheme";
import type { UIThemeIconProps } from "../types";
import { ThemeIcon } from "./ThemeIcon";

afterEach(cleanup);

function renderIcon(props: UIThemeIconProps = {}): HTMLSpanElement {
  const { container } = render(() => <ThemeIcon {...props}>i</ThemeIcon>);
  return container.querySelector("span")!;
}

describe("ThemeIcon", () => {
  test("maps size presets, numeric sizes and the default to a square with half-size glyph", () => {
    const cases: Array<[UIThemeIconProps["size"], string]> = [
      [undefined, "36px"],
      ["xs", "20px"],
      ["sm", "28px"],
      ["md", "36px"],
      ["lg", "48px"],
      ["xl", "56px"],
      [24, "24px"],
      ["40", "40px"],
    ];

    for (const [size, px] of cases) {
      const icon = renderIcon({ size });
      expect(icon.style.width, `size ${String(size)} width`).toBe(px);
      expect(icon.style.height, `size ${String(size)} height`).toBe(px);
      expect(icon.style.fontSize, `size ${String(size)} glyph`).toBe(`${Number(px.replace("px", "")) / 2}px`);
    }
  });

  test("maps radius presets to the border-radius token", () => {
    const cases: Array<[UIThemeIconProps["radius"], string]> = [
      [undefined, "6px"],
      ["xs", "4px"],
      ["xl", "16px"],
      [8, "8px"],
    ];

    for (const [radius, expected] of cases) {
      expect(renderIcon({ radius }).style.borderRadius, `radius ${String(radius)}`).toBe(expected);
    }
  });

  test("resolves semantic colours from the shared sxTheme palette", () => {
    const error = renderIcon({ color: "error" });
    expect(error.style.backgroundColor).toBe(sxTheme.palette.error.main);
    expect(error.style.color).toBe(sxTheme.palette.error.contrastText);

    const success = renderIcon({ color: "success" });
    expect(success.style.backgroundColor).toBe(sxTheme.palette.success.main);
    expect(success.style.color).toBe(sxTheme.palette.success.contrastText);
  });

  test("variants choose contrast fill, transparent outline and paper surfaces", () => {
    const filled = renderIcon({ variant: "filled", color: "primary" });
    expect(filled.style.backgroundColor).toBe(sxTheme.palette.primary.contrastText);
    expect(filled.className).toContain("text-white");
    expect(filled.style.color).toBe("");

    const outline = renderIcon({ variant: "outline", color: "primary" });
    expect(outline.style.backgroundColor).toBe("transparent");
    expect(outline.style.color).toBe(sxTheme.palette.primary.contrastText);

    const white = renderIcon({ variant: "white", color: "primary" });
    expect(white.style.backgroundColor).toBe(sxTheme.palette.background.paper);
    expect(white.style.color).toBe(sxTheme.palette.primary.contrastText);

    const plain = renderIcon({ variant: "default", color: "primary" });
    expect(plain.style.backgroundColor).toBe(sxTheme.palette.background.paper);

    const light = renderIcon({ variant: "light", color: "primary" });
    expect(light.style.backgroundColor).toBe(sxTheme.palette.primary.main);
  });
});
