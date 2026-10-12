// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import type { ReactElement } from "react";

import { Sparkline } from "./Sparkline";

const renderWithProvider = (ui: ReactElement) => render(<UIProvider>{ui}</UIProvider>);

describe("Sparkline", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders one point per value and colors green for gains", () => {
    renderWithProvider(<Sparkline data={[0.1, 0.3, 0.6, 0.9]} change={19.99} />);
    const spark = screen.getByTestId("sparkline");
    expect(spark).toHaveAttribute("data-positive", "true");
    expect(spark).toHaveAttribute("data-points", "4");
    const poly = spark.querySelector("polyline");
    expect(poly).not.toBeNull();
    expect(poly?.getAttribute("points")?.trim().split(" ")).toHaveLength(4);
    expect(poly?.getAttribute("stroke")).toBe("var(--mui-palette-success-main)");
  });

  it("colors red for losses", () => {
    renderWithProvider(<Sparkline data={[0.9, 0.7, 0.2]} change={-1.5} />);
    const spark = screen.getByTestId("sparkline");
    expect(spark).toHaveAttribute("data-positive", "false");
    expect(spark?.querySelector("polyline")?.getAttribute("stroke")).toBe(
      "var(--mui-palette-error-main)",
    );
  });

  it("renders a flat line when data is empty", () => {
    renderWithProvider(<Sparkline data={[]} change={0} />);
    const spark = screen.getByTestId("sparkline");
    expect(spark).toHaveAttribute("data-points", "0");
    const points = spark.querySelector("polyline")?.getAttribute("points")?.trim().split(" ");
    expect(points).toHaveLength(2);
    // flat: both y values equal
    expect(points?.[0].split(",")[1]).toBe(points?.[1].split(",")[1]);
  });

  it("renders a flat line for a single point", () => {
    renderWithProvider(<Sparkline data={[0.8]} change={1} />);
    const points = screen
      .getByTestId("sparkline")
      .querySelector("polyline")
      ?.getAttribute("points")
      ?.trim()
      .split(" ");
    expect(points).toHaveLength(2);
    expect(points?.[0].split(",")[1]).toBe(points?.[1].split(",")[1]);
  });

  it("uses preserveAspectRatio none so it stretches to its box", () => {
    renderWithProvider(<Sparkline data={[0.2, 0.5]} change={0} width={64} height={20} />);
    expect(screen.getByTestId("sparkline").querySelector("svg")).toHaveAttribute(
      "preserveAspectRatio",
      "none",
    );
  });
});
