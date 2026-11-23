// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { TYPE_SCALE, typeSize } from "../typography";
import { Indicator } from "./Indicator";

describe("Indicator", () => {
  test("renders children without a dot when disabled", () => {
    render(() => <Indicator disabled data-testid="ind">content</Indicator>);
    const el = screen.getByTestId("ind");
    expect(el.textContent).toBe("content");
    expect(el.querySelector(".animate-ping")).toBeNull();
  });

  test("shows a processing dot", () => {
    render(() => <Indicator processing data-testid="ind2">content</Indicator>);
    expect(screen.getByTestId("ind2").querySelector(".animate-ping")).toBeInTheDocument();
  });

  test("renders the label inside the dot", () => {
    render(() => <Indicator label="3" color="error" data-testid="ind3">content</Indicator>);
    expect(screen.getByTestId("ind3").textContent).toContain("3");
  });

  test("the dot label snaps to the shared ladder and never drops below 12px", () => {
    const scale = Object.values(TYPE_SCALE).map((s) => s.size);
    for (const size of [4, 8, 16, 24, 32] as const) {
      render(() => <Indicator size={size} label="3" data-testid={`ind-${size}`}>content</Indicator>);
      const dot = screen.getByTestId(`ind-${size}`).querySelector('span[class*="rounded-full"]') as HTMLElement;
      const px = Number.parseFloat(dot.style.fontSize);
      expect(scale, `size ${size}`).toContain(px);
      expect(px, `size ${size}`).toBeGreaterThanOrEqual(typeSize("micro"));
    }
  });
});
