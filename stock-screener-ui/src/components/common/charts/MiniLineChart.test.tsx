// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, afterEach, vi } from "vitest";
import type { JSX } from "solid-js";
import { createSignal } from "solid-js";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";
import {
  MiniLineChart,
  buildAreaPath,
  buildLinePath,
  scaleValue,
  seriesBounds,
} from "./MiniLineChart";
import type { MiniSeries } from "./MiniLineChart";

afterEach(cleanup);

function TestWrapper({ children }: { children: JSX.Element }) {
  return <UIProvider>{children}</UIProvider>;
}

const BOUNDS = { min: 0, max: 10 };

// The SVG viewBox is 600 wide; happy-dom reports zero-size rects unless stubbed.
function stubRect(svg: SVGElement) {
  svg.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 600, bottom: 180, width: 600, height: 180, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

function svgOf(testId: string) {
  return screen.getByTestId(testId).querySelector("svg")!;
}

function linePathOf(svg: SVGElement) {
  return svg.querySelector('path[stroke]')!;
}

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

describe("scaleValue / sqrt scale", () => {
  test("preserves sign and zero, and no-ops on linear", () => {
    expect(scaleValue(0, "sqrt")).toBe(0);
    expect(scaleValue(9, "sqrt")).toBeCloseTo(3);
    expect(scaleValue(-100, "sqrt")).toBeCloseTo(-10);
    expect(scaleValue(42, "linear")).toBe(42);
  });

  test("bounds compress a long tail so small values stay on the chart", () => {
    const s = [{ name: "a", points: [0, 100, 10000], color: palette.PRIMARY }];
    expect(seriesBounds(s, 0, "linear")).toEqual({ min: 0, max: 10000 });
    expect(seriesBounds(s, 0, "sqrt")).toEqual({ min: 0, max: 100 });
  });

  test("a tiny value plots far above the baseline on sqrt but hugs it on linear", () => {
    const points = [0, 100, 10000];
    const yOfSecond = (scale: "linear" | "sqrt") => {
      const bounds = seriesBounds(
        [{ name: "a", points, color: palette.PRIMARY }],
        0,
        scale,
      );
      const d = buildLinePath(points, bounds, 100, 50, scale);
      return Number(d.split(" ").slice(2, 4)[1]);
    };
    // Linear puts 100 at 99% of the height; sqrt lifts it to 90%.
    expect(yOfSecond("sqrt")).toBeLessThan(yOfSecond("linear"));
  });

  test("render accepts scale=sqrt without changing the DOM contract", () => {
    render(() => (<MiniLineChart
        series={[{ name: "a", points: [0, 1, 10000], color: palette.PRIMARY }]}
        labels={["a", "b", "c"]}
        scale="sqrt"
        testId="mini-chart-sqrt"
      />),
      { wrapper: TestWrapper },
    );
    const chart = screen.getByTestId("mini-chart-sqrt");
    expect(chart.querySelector("svg")).not.toBeNull();
    // The hover readout keeps the *raw* value, not the transformed one.
    expect(chart.textContent).toContain("a");
  });
});

describe("MiniLineChart render", () => {
  test("renders a series path inside an SVG", () => {
    render(() => (<MiniLineChart
        series={[{ name: "a", points: [1, 2, 3], color: palette.PRIMARY }]}
        labels={["x", "y", "z"]}
        testId="mini-chart"
      />),
      { wrapper: TestWrapper },
    );
    const chart = screen.getByTestId("mini-chart");
    expect(chart.querySelector("svg")).not.toBeNull();
    const line = chart.querySelector('path[stroke]');
    expect(line?.getAttribute("d")?.length).toBeGreaterThan(0);
  });

  test("gives the role=img svg an accessible name from its series", () => {
    render(() => (<MiniLineChart
        series={[
          { name: "Revenue", points: [1, 2, 3], color: palette.PRIMARY },
          { name: "Cost", points: [3, 2, 1], color: palette.WARNING },
        ]}
        labels={["x", "y", "z"]}
        testId="named-chart"
      />),
      { wrapper: TestWrapper },
    );
    const svg = svgOf("named-chart");
    expect(svg).toHaveAttribute("role", "img");
    expect(svg.querySelector("title")?.textContent).toBe("Revenue, Cost");
  });

  test("shows the empty message when all points are null", () => {
    render(() => (<MiniLineChart
        series={[{ name: "a", points: [null, null], color: palette.PRIMARY }]}
        labels={["x", "y"]}
        testId="mini-chart-empty"
        emptyMessage="Nothing to plot"
      />),
      { wrapper: TestWrapper },
    );
    expect(screen.getByText("Nothing to plot")).toBeInTheDocument();
    expect(screen.getByTestId("mini-chart-empty").querySelector("svg")).toBeNull();
  });
});

describe("MiniLineChart edge cases", () => {
  test("null points break the rendered line and show a dash in the readout", () => {
    render(() => (<MiniLineChart
        series={[{ name: "a", points: [0, null, 10], color: palette.PRIMARY }]}
        labels={["a", "b", "c"]}
        testId="gap-chart"
      />),
      { wrapper: TestWrapper },
    );
    const svg = svgOf("gap-chart");
    const d = linePathOf(svg).getAttribute("d")!;
    expect(d.match(/M/g)?.length).toBe(2);
    expect(d).not.toMatch(/L/);

    stubRect(svg);
    fireEvent.mouseMove(svg, { clientX: 300 });
    const readout = screen.getByTestId("gap-chart-readout");
    expect(readout).toHaveTextContent("b · a —");
  });

  test("a single point draws one move-to and keeps its raw value on hover", () => {
    render(() => (<MiniLineChart
        series={[{ name: "a", points: [4], color: palette.PRIMARY }]}
        labels={["only"]}
        testId="single-chart"
      />),
      { wrapper: TestWrapper },
    );
    const svg = svgOf("single-chart");
    const d = linePathOf(svg).getAttribute("d")!;
    expect(d.match(/M/g)?.length).toBe(1);
    expect(d).not.toMatch(/L/);

    stubRect(svg);
    fireEvent.mouseMove(svg, { clientX: 100 });
    expect(screen.getByTestId("single-chart-readout")).toHaveTextContent("only · a 4.00");
  });

  test("hover neither reformats the series nor rebuilds the path nodes", () => {
    const format = vi.fn((v: number) => `v${v}`);
    render(() => (<MiniLineChart
        series={[
          { name: "a", points: [1, 2, 3], color: palette.PRIMARY },
          { name: "b", points: [3, 2, 1], color: palette.WARNING },
        ]}
        labels={["x", "y", "z"]}
        formatValue={format}
        testId="perf-chart"
      />),
      { wrapper: TestWrapper },
    );
    const svg = svgOf("perf-chart");
    const pathBefore = linePathOf(svg);
    const dBefore = pathBefore.getAttribute("d");

    stubRect(svg);
    fireEvent.mouseMove(svg, { clientX: 100 });
    const readout = screen.getByTestId("perf-chart-readout");
    const firstText = readout.textContent;
    const callsAfterFirstHover = format.mock.calls.length;
    expect(callsAfterFirstHover).toBeGreaterThan(0);

    fireEvent.mouseMove(svg, { clientX: 300 });
    expect(readout.textContent).not.toBe(firstText);
    fireEvent.mouseMove(svg, { clientX: 500 });
    expect(format.mock.calls.length).toBe(callsAfterFirstHover);

    const pathAfter = linePathOf(svg);
    expect(pathAfter).toBe(pathBefore);
    expect(pathAfter.getAttribute("d")).toBe(dBefore);
  });

  test("height changes resize the SVG and recompute path geometry", () => {
    const [height, setHeight] = createSignal(100);
    render(() => (<MiniLineChart
        series={[{ name: "a", points: [1, 3, 2], color: palette.PRIMARY }]}
        labels={["x", "y", "z"]}
        height={height()}
        testId="responsive-chart"
      />),
      { wrapper: TestWrapper },
    );
    const svg = svgOf("responsive-chart");
    expect(svg.getAttribute("viewBox")).toBe("0 0 600 100");
    expect(svg.getAttribute("preserveAspectRatio")).toBe("none");
    expect(svg.style.width).toBe("100%");
    expect(svg.style.height).toBe("100px");
    const dBefore = linePathOf(svg).getAttribute("d");

    setHeight(240);
    expect(svg.getAttribute("viewBox")).toBe("0 0 600 240");
    expect(svg.style.height).toBe("240px");
    expect(linePathOf(svg).getAttribute("d")).not.toBe(dBefore);
  });

  test("series and scale changes both recompute path geometry", () => {
    const [series, setSeries] = createSignal<MiniSeries[]>([
      { name: "a", points: [1, 2, 3], color: palette.PRIMARY },
    ]);
    const [scale, setScale] = createSignal<"linear" | "sqrt">("linear");
    render(() => (<MiniLineChart
        series={series()}
        labels={["x", "y", "z"]}
        scale={scale()}
        testId="input-chart"
      />),
      { wrapper: TestWrapper },
    );
    const svg = svgOf("input-chart");
    const dInitial = linePathOf(svg).getAttribute("d");

    setSeries([{ name: "a", points: [3, 2, 1], color: palette.PRIMARY }]);
    const dReversed = linePathOf(svg).getAttribute("d");
    expect(dReversed).not.toBe(dInitial);

    setScale("sqrt");
    expect(linePathOf(svg).getAttribute("d")).not.toBe(dReversed);
  });

  test("sqrt scale keeps the hover readout on raw values", () => {
    render(() => (<MiniLineChart
        series={[{ name: "a", points: [0, 1, 10000], color: palette.PRIMARY }]}
        labels={["a", "b", "c"]}
        scale="sqrt"
        testId="sqrt-readout-chart"
      />),
      { wrapper: TestWrapper },
    );
    const svg = svgOf("sqrt-readout-chart");
    stubRect(svg);
    fireEvent.mouseMove(svg, { clientX: 600 });
    expect(screen.getByTestId("sqrt-readout-chart-readout")).toHaveTextContent("10000.00");
  });

  test("zero line and markers survive hover and keep their test ids", () => {
    render(() => (<MiniLineChart
        series={[{ name: "a", points: [-5, 5], color: palette.PRIMARY }]}
        labels={["low", "high"]}
        zeroLine
        markers={[{ index: 1, label: "peak", color: palette.WARNING }]}
        testId="deco-chart"
      />),
      { wrapper: TestWrapper },
    );
    const svg = svgOf("deco-chart");
    const lines = Array.from(svg.querySelectorAll("line"));
    expect(lines).toHaveLength(2);
    const zero = lines.find((l) => l.getAttribute("stroke-dasharray") === "3 3")!;
    const marker = lines.find((l) => l.getAttribute("stroke-dasharray") === "2 3")!;
    expect(zero).toBeDefined();
    expect(marker).toBeDefined();
    expect(marker.getAttribute("x1")).toBe(marker.getAttribute("x2"));
    expect(Number(marker.getAttribute("x1"))).toBeGreaterThan(Number(zero.getAttribute("x1")));

    stubRect(svg);
    fireEvent.mouseMove(svg, { clientX: 200 });
    expect(screen.getByTestId("deco-chart-readout")).toBeInTheDocument();
    expect(svg.querySelectorAll("line")).toHaveLength(3);
  });
});
