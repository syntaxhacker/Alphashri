// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
import { sxTheme } from "../sxTheme";
import { TYPE_SCALE, typeSize, type TypeRole } from "../typography";
import { alpha } from "../palette";
import type { UIThemeIconProps } from "../types";
import { ThemeIcon } from "./ThemeIcon";

afterEach(cleanup);

function renderIcon(props: UIThemeIconProps = {}): HTMLSpanElement {
  const { container } = render(() => <ThemeIcon {...props}>i</ThemeIcon>);
  return container.querySelector("span")!;
}

describe("ThemeIcon", () => {
  test("maps size presets, numeric sizes and the default to a square with an on-scale glyph", () => {
    const cases: Array<[UIThemeIconProps["size"], string, TypeRole]> = [
      [undefined, "36px", "heading"],
      ["xs", "20px", "micro"],
      ["sm", "28px", "label"],
      ["md", "36px", "heading"],
      ["lg", "48px", "display"],
      ["xl", "56px", "display"],
      [24, "24px", "micro"],
      ["40", "40px", "heading"],
    ];

    for (const [size, px, role] of cases) {
      const icon = renderIcon({ size });
      expect(icon.style.width, `size ${String(size)} width`).toBe(px);
      expect(icon.style.height, `size ${String(size)} height`).toBe(px);
      expect(icon.style.fontSize, `size ${String(size)} glyph`).toBe(`${typeSize(role)}px`);
    }
  });

  test("every decorative glyph stays on the shared ladder and above the floor", () => {
    const scale = Object.values(TYPE_SCALE).map((s) => s.size);
    for (const size of [1, 8, 20, 24, 28, 36, 48, 56, 64] as const) {
      const glyph = Number.parseFloat(renderIcon({ size }).style.fontSize);
      expect(scale, `size ${size}`).toContain(glyph);
      expect(glyph, `size ${size}`).toBeGreaterThanOrEqual(typeSize("micro"));
      cleanup();
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
    expect(error.style.backgroundColor).toBe(alpha(sxTheme.palette.error.main, 0.12));
    expect(error.style.color).toBe(sxTheme.palette.error.main);

    const success = renderIcon({ color: "success" });
    expect(success.style.backgroundColor).toBe(alpha(sxTheme.palette.success.main, 0.12));
    expect(success.style.color).toBe(sxTheme.palette.success.main);
  });

  test("variants choose contrast fill, transparent outline and paper surfaces", () => {
    const filled = renderIcon({ variant: "filled", color: "primary" });
    expect(filled.style.backgroundColor).toBe(sxTheme.palette.primary.main);
    expect(filled.style.color).toBe(sxTheme.palette.primary.contrastText);

    const outline = renderIcon({ variant: "outline", color: "primary" });
    expect(outline.style.backgroundColor).toBe("transparent");
    expect(outline.style.color).toBe(sxTheme.palette.primary.main);

    const white = renderIcon({ variant: "white", color: "primary" });
    expect(white.style.backgroundColor).toBe(sxTheme.palette.background.paper);
    expect(white.style.color).toBe(sxTheme.palette.primary.main);

    const plain = renderIcon({ variant: "default", color: "primary" });
    expect(plain.style.backgroundColor).toBe(alpha(sxTheme.palette.primary.main, 0.12));
    expect(plain.style.color).toBe(sxTheme.palette.primary.main);

    const light = renderIcon({ variant: "light", color: "primary" });
    expect(light.style.backgroundColor).toBe(alpha(sxTheme.palette.primary.main, 0.12));
    expect(light.style.color).toBe(sxTheme.palette.primary.main);
  });
});
