// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { NiftyFlowChart } from "./NiftyFlowChart";
import { buildFlowSeries } from "./niftyFlowSeries";

afterEach(cleanup);

function series() {
  const rows = Array.from({ length: 40 }, (_, i) => {
    const m = 13 * 60 + i;
    return {
      t: `2026-10-23T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00+05:30`,
      net_pct: i * 0.05,
      net_gex: i < 20 ? -5 : 4,
    };
  });
  return buildFlowSeries(rows);
}

describe("NiftyFlowChart", () => {
  test("draws the flow path, the gamma strip, a flip and the axis", () => {
    render(<NiftyFlowChart series={series()} showAxis />);
    const svg = screen.getByTestId("nifty-flowchart-svg");
    expect(svg.querySelector("path")).not.toBeNull();
    // 40 regime cells + zero line + flip + flow path
    expect(svg.querySelectorAll("rect").length).toBe(40);
    expect(svg.querySelectorAll("line").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("nifty-flowchart-axis")).toHaveTextContent(/13:\d\d/);
    expect(screen.getByTestId("nifty-flowchart-last")).toBeInTheDocument();
  });

  test("hover reads the minute, flow and regime", () => {
    render(<NiftyFlowChart series={series()} showAxis />);
    const svg = screen.getByTestId("nifty-flowchart-svg");
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 1000, bottom: 56, width: 1000, height: 56, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.mouseMove(svg, { clientX: 500 });
    const readout = screen.getByTestId("nifty-flowchart-readout");
    expect(readout).toHaveTextContent(/13:\d\d/);
    expect(readout).toHaveTextContent(/flow/);
    expect(readout).toHaveTextContent(/Γ/);
  });

  test("empty series renders the muted state", () => {
    render(<NiftyFlowChart series={buildFlowSeries([])} />);
    expect(screen.getByTestId("nifty-flowchart-empty")).toBeInTheDocument();
  });
});
