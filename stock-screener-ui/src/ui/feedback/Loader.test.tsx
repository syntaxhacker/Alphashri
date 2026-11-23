// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import * as palette from "../palette";
import { Loader } from "./Loader";

describe("Loader", () => {
  test("renders a track ring and a moving arc by default", () => {
    render(() => <Loader data-testid="ld" />);
    const root = screen.getByTestId("ld");
    const svg = root.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(root).toHaveAttribute("role", "progressbar");
    const circles = svg?.querySelectorAll("circle") ?? [];
    expect(circles).toHaveLength(2);
    // Full-circle track plus a short dash that rotates over it.
    expect(circles[0]).toHaveAttribute("opacity", "0.18");
    expect(circles[1]).toHaveAttribute("stroke-dasharray", "14 43");
    expect(circles[1]).toHaveAttribute("stroke-linecap", "round");
    expect(svg).toHaveAttribute("data-fin-motion", "loader");
    expect((svg as SVGSVGElement).style.animation).toContain("fin-loader-spin");
  });

  test("is labelled for assistive tech and marked busy", () => {
    render(() => <Loader data-testid="ld-a11y" />);
    const root = screen.getByTestId("ld-a11y");
    expect(root).toHaveAttribute("aria-label", "Loading");
    expect(root).toHaveAttribute("aria-busy", "true");
  });

  test("honours an explicit accessible name", () => {
    const named = { "aria-label": "Refreshing quotes", "data-testid": "ld-label" };
    render(() => <Loader {...named} />);
    expect(screen.getByTestId("ld-label")).toHaveAttribute("aria-label", "Refreshing quotes");
  });

  test("keeps currentColor so a caller can recolour the marks", () => {
    render(() => <Loader data-testid="ld-color" color="primary" />);
    const root = screen.getByTestId("ld-color");
    expect(root.style.color).toBe(palette.PRIMARY);
    const circles = root.querySelectorAll("circle");
    for (const circle of circles) expect(circle).toHaveAttribute("stroke", "currentColor");
  });

  test("renders bars type with three scaled bars", () => {
    render(() => <Loader type="bars" data-testid="ld2" />);
    const bars = screen.getByTestId("ld2").querySelectorAll("[data-loader-part='bar']");
    expect(bars).toHaveLength(3);
    for (const bar of bars) {
      expect((bar as HTMLElement).style.width).toBe("18%");
      expect(bar).toHaveAttribute("data-fin-motion", "loader");
    }
    expect((bars[0] as HTMLElement).style.animationDelay).not.toBe((bars[1] as HTMLElement).style.animationDelay);
  });

  test("renders dots type with three scaled dots", () => {
    render(() => <Loader type="dots" data-testid="ld3" />);
    const dots = screen.getByTestId("ld3").querySelectorAll("[data-loader-part='dot']");
    expect(dots).toHaveLength(3);
    for (const dot of dots) {
      expect((dot as HTMLElement).style.width).toBe("22%");
      expect((dot as HTMLElement).style.height).toBe("22%");
      expect(dot).toHaveAttribute("data-fin-motion", "loader");
    }
  });

  test("xs, sm and md map to the documented diameters", () => {
    render(() => (
      <>
        <Loader size="xs" data-testid="ld-xs" />
        <Loader size="sm" data-testid="ld-sm" />
        <Loader size="md" data-testid="ld-md" />
      </>
    ));
    expect(screen.getByTestId("ld-xs").style.width).toBe("16px");
    expect(screen.getByTestId("ld-sm").style.width).toBe("20px");
    expect(screen.getByTestId("ld-md").style.width).toBe("28px");
  });
});
