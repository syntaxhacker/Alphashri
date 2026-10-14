// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";
import {
  MiniLineChart,
  buildAreaPath,
  buildLinePath,
  seriesBounds,
} from "./MiniLineChart";

afterEach(cleanup);

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

const BOUNDS = { min: 0, max: 10 };

describe("seriesBounds", () => {
  test("returns min/max across finite points", () => {
    const b = seriesBounds(
      [{ name: "a", points: [1, 5, 3], color: palette.PRIMARY }],
      0,
    );
    expect(b).toEqual({ min: 1, max: 5 });
  });

  test("ignores null and non-finite points", () => {
    const b = seriesBounds(
      [
        {
          name: "a",
          points: [null, Number.NaN, Number.POSITIVE_INFINITY, 2, 8],
          color: palette.PRIMARY,
        },
      ],
      0,
    );
    expect(b).toEqual({ min: 2, max: 8 });
  });

  test("single value is padded on both sides", () => {
    const b = seriesBounds([{ name: "a", points: [4], color: palette.PRIMARY }], 0);
    expect(b.min).toBeLessThan(4);
    expect(b.max).toBeGreaterThan(4);
  });

  test("single zero value pads by fallback amount", () => {
    expect(
      seriesBounds([{ name: "a", points: [0], color: palette.PRIMARY }], 0),
    ).toEqual({ min: -1, max: 1 });
  });

  test("only counts series on the requested axis", () => {
    const b = seriesBounds(
      [
        { name: "left", points: [1, 2], color: palette.PRIMARY, axis: 0 },
        { name: "right", points: [100, 200], color: palette.WARNING, axis: 1 },
      ],
      0,
    );
    expect(b).toEqual({ min: 1, max: 2 });
  });

  test("no finite points yields the default range", () => {
    expect(
      seriesBounds([{ name: "a", points: [null, null], color: palette.PRIMARY }], 0),
    ).toEqual({ min: 0, max: 1 });
  });
});

describe("buildLinePath", () => {
  test("empty points yield an empty path", () => {
    expect(buildLinePath([], BOUNDS, 100, 50)).toBe("");
  });

  test("all-null points yield an empty path", () => {
    expect(buildLinePath([null, null], BOUNDS, 100, 50)).toBe("");
  });

  test("null points break the line into separate subpaths", () => {
    const d = buildLinePath([0, null, 10], BOUNDS, 100, 50);
    expect(d).not.toBe("");
    expect(d.match(/M/g)?.length).toBe(2);
    expect(d).not.toMatch(/L/);
  });

  test("consecutive finite points are joined with L", () => {
    const d = buildLinePath([0, 5, 10], BOUNDS, 100, 50);
    expect(d.match(/M/g)?.length).toBe(1);
    expect(d.match(/L/g)?.length).toBe(2);
  });
});

describe("buildAreaPath", () => {
  test("closes the line path back to the baseline", () => {
    const d = buildAreaPath([0, 10], BOUNDS, 100, 50);
    expect(d).not.toBe("");
    expect(d.endsWith("Z")).toBe(true);
  });

  test("empty string when there are no finite points", () => {
    expect(buildAreaPath([], BOUNDS, 100, 50)).toBe("");
    expect(buildAreaPath([null, null], BOUNDS, 100, 50)).toBe("");
  });
});

describe("MiniLineChart render", () => {
  test("renders a series path inside an SVG", () => {
    render(
      <MiniLineChart
        series={[{ name: "a", points: [1, 2, 3], color: palette.PRIMARY }]}
        labels={["x", "y", "z"]}
        testId="mini-chart"
      />,
      { wrapper: TestWrapper },
    );
    const chart = screen.getByTestId("mini-chart");
    expect(chart.querySelector("svg")).not.toBeNull();
    const line = chart.querySelector('path[stroke]');
    expect(line?.getAttribute("d")?.length).toBeGreaterThan(0);
  });

  test("shows the empty message when all points are null", () => {
    render(
      <MiniLineChart
        series={[{ name: "a", points: [null, null], color: palette.PRIMARY }]}
        labels={["x", "y"]}
        testId="mini-chart-empty"
        emptyMessage="Nothing to plot"
      />,
      { wrapper: TestWrapper },
    );
    expect(screen.getByText("Nothing to plot")).toBeInTheDocument();
    expect(screen.getByTestId("mini-chart-empty").querySelector("svg")).toBeNull();
  });
});
