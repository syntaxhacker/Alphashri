// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { NiftyPressureLane } from "./NiftyPressureLane";
import { buildPressure } from "./niftyPressure";

afterEach(cleanup);

function series(ceLast = 0) {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    t: `2026-10-23T13:${String(20 + i).padStart(2, "0")}:00`,
    ce_vol: (i + 1) * 4_000_000,
    pe_vol: (i + 1) * 1_000_000,
  }));
  if (ceLast > 0) {
    rows.push({
      t: "2026-10-23T13:30:00",
      ce_vol: 10 * 4_000_000 + ceLast,
      pe_vol: 10 * 1_000_000,
    });
  }
  return buildPressure(rows);
}

describe("NiftyPressureLane", () => {
  test("renders one bar group per minute plus the last-minute multiple", () => {
    render(<NiftyPressureLane series={series(20_000_000)} />);
    const svg = screen.getByTestId("nifty-pressure-svg");
    expect(svg.querySelectorAll("rect").length).toBeGreaterThan(10);
    expect(screen.getByTestId("nifty-pressure-last")).toHaveTextContent("×");
  });

  test("shows the empty state without volume", () => {
    render(<NiftyPressureLane series={buildPressure([])} />);
    expect(screen.getByTestId("nifty-pressure-empty")).toBeInTheDocument();
  });

  test("hover reads the exact minute (time, CE, PE, multiple)", () => {
    render(<NiftyPressureLane series={series(20_000_000)} showAxis />);
    const svg = screen.getByTestId("nifty-pressure-svg");
    // happy-dom has no layout: give the element a real box for the hit-test.
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 1000, bottom: 40, width: 1000, height: 40, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.mouseMove(svg, { clientX: 900 });
    const readout = screen.getByTestId("nifty-pressure-readout");
    expect(readout).toHaveTextContent(/13:(2|3)\d/);
    expect(readout).toHaveTextContent(/CE/);
    expect(readout).toHaveTextContent(/×/);
    fireEvent.mouseLeave(svg);
    expect(screen.queryByTestId("nifty-pressure-readout")).not.toBeInTheDocument();
  });

  test("renders an HH:MM axis when expanded", () => {
    render(<NiftyPressureLane series={series(20_000_000)} showAxis />);
    const axis = screen.getByTestId("nifty-pressure-axis");
    expect(axis).toBeInTheDocument();
    // 13:20 start, every 30-min mark or the first/last label.
    expect(axis.textContent).toMatch(/13:\d\d/);
    const legend = screen.getByTestId("nifty-pressure-legend");
    expect(legend).toHaveTextContent(/CE volume/);
    expect(legend).toHaveTextContent(/PE volume/);
    expect(legend).toHaveTextContent(/median/);
    expect(legend).toHaveTextContent(/burst/);
  });
});
