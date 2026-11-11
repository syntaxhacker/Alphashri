// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { UIProvider } from "@/ui";
import { Sparkline } from "./Sparkline";

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: UIProvider });
}

afterEach(cleanup);

describe("Sparkline", () => {
  test("default: renders svg with width/height attributes and testId", () => {
    r(<Sparkline values={[1, 2, 3, 4, 5]} width={100} height={20} testId="spark-test" />);
    const svg = screen.getByTestId("spark-test");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("width", "100");
    expect(svg).toHaveAttribute("height", "20");
    expect(svg).toHaveAttribute("viewBox", "0 0 100 20");
    expect(svg).toHaveAttribute("data-testid", "spark-test");
  });

  test("default: data-points preserved via viewBox scaling", () => {
    r(<Sparkline values={[10, 20, 15, 25, 30]} width={50} height={12} testId="spark-points" />);
    const svg = screen.getByTestId("spark-points");
    const polyline = svg.querySelector("polyline");
    expect(polyline).toBeInTheDocument();
    const points = polyline!.getAttribute("points");
    expect(points).toContain("0,");
    expect(points).toContain("50.0,");
  });

  test("responsive: omits width/height attributes, uses inline style width: 100%, height: auto", () => {
    r(<Sparkline values={[1, 2, 3, 4, 5]} width={100} height={20} testId="spark-responsive" responsive />);
    const svg = screen.getByTestId("spark-responsive");
    expect(svg).not.toHaveAttribute("width");
    expect(svg).not.toHaveAttribute("height");
    expect(svg).toHaveAttribute("viewBox", "0 0 100 20");
    expect(svg).toHaveStyle({ width: "100%", height: "auto" });
  });

  test("responsive: still renders polyline with correct points", () => {
    r(<Sparkline values={[10, 20, 15, 25, 30]} width={50} height={12} testId="spark-resp-points" responsive />);
    const svg = screen.getByTestId("spark-resp-points");
    const polyline = svg.querySelector("polyline");
    expect(polyline).toBeInTheDocument();
    const points = polyline!.getAttribute("points");
    expect(points).toContain("0,");
    expect(points).toContain("50.0,");
  });

  test("empty array: returns null, no crash", () => {
    r(<Sparkline values={[]} width={44} height={12} testId="spark-empty" />);
    expect(screen.queryByTestId("spark-empty")).not.toBeInTheDocument();
  });

  test("single point array: returns null, no crash", () => {
    r(<Sparkline values={[42]} width={44} height={12} testId="spark-single" />);
    expect(screen.queryByTestId("spark-single")).not.toBeInTheDocument();
  });

  test("null/undefined values in array: filtered out, renders with remaining", () => {
    r(<Sparkline values={[1, null, 3, undefined, 5]} width={40} height={10} testId="spark-nulls" />);
    const svg = screen.getByTestId("spark-nulls");
    expect(svg).toBeInTheDocument();
    const polyline = svg.querySelector("polyline");
    expect(polyline).toBeInTheDocument();
  });

  test("animate: sets pathLength, strokeDasharray, strokeDashoffset and animation style", () => {
    r(<Sparkline values={[1, 2, 3]} width={30} height={8} testId="spark-animate" animate />);
    const svg = screen.getByTestId("spark-animate");
    const polyline = svg.querySelector("polyline");
    expect(polyline).toHaveAttribute("pathLength", "1");
    // strokeDasharray/strokeDashoffset are set as SVG attributes via JSX props
    expect(polyline).toHaveAttribute("stroke-dasharray", "1");
    expect(polyline).toHaveAttribute("stroke-dashoffset", "1");
    expect(polyline).toHaveStyle({ animation: "wall-spark-draw 420ms cubic-bezier(.22,1,.36,1) forwards" });
  });

  test("animate + responsive: both behaviors combine", () => {
    r(<Sparkline values={[1, 2, 3]} width={30} height={8} testId="spark-both" animate responsive />);
    const svg = screen.getByTestId("spark-both");
    expect(svg).not.toHaveAttribute("width");
    expect(svg).not.toHaveAttribute("height");
    expect(svg).toHaveStyle({ width: "100%", height: "auto" });
    const polyline = svg.querySelector("polyline");
    expect(polyline).toHaveAttribute("pathLength", "1");
  });

  test("custom color passed through to polyline stroke", () => {
    r(<Sparkline values={[1, 2, 3]} width={20} height={10} color="#FF0000" testId="spark-color" />);
    const polyline = screen.getByTestId("spark-color").querySelector("polyline");
    expect(polyline).toHaveAttribute("stroke", "#FF0000");
  });

  test("default color is currentColor", () => {
    r(<Sparkline values={[1, 2, 3]} width={20} height={10} testId="spark-default-color" />);
    const polyline = screen.getByTestId("spark-default-color").querySelector("polyline");
    expect(polyline).toHaveAttribute("stroke", "currentColor");
  });
});