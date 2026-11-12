// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { Indicator } from "./Indicator";

describe("Indicator", () => {
  test("renders children without a dot when disabled", () => {
    render(<Indicator disabled data-testid="ind">content</Indicator>);
    const el = screen.getByTestId("ind");
    expect(el.textContent).toBe("content");
    expect(el.querySelector(".animate-ping")).toBeNull();
  });

  test("shows a processing dot", () => {
    render(<Indicator processing data-testid="ind2">content</Indicator>);
    expect(screen.getByTestId("ind2").querySelector(".animate-ping")).toBeInTheDocument();
  });

  test("renders the label inside the dot", () => {
    render(<Indicator label="3" color="error" data-testid="ind3">content</Indicator>);
    expect(screen.getByTestId("ind3").textContent).toContain("3");
  });
});
