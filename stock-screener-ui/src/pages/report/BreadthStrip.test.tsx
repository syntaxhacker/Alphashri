// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, test } from "vitest";
import { BreadthStrip } from "./BreadthStrip";
import type { BreadthPayload } from "@/api/reportNifty";

afterEach(cleanup);

function payload(over: Partial<BreadthPayload> = {}): BreadthPayload {
  return {
    available: true,
    count: 5,
    up: 4,
    rows: [
      { label: "NIFTY", last: 24_650, close: 24_450, change_pct: 0.82 },
      { label: "BANK", last: 52_100, close: 51_800, change_pct: 0.58 },
      { label: "MID", last: 58_900, close: 59_300, change_pct: -0.68 },
      { label: "SMALL", last: 18_200, close: 18_420, change_pct: -1.2 },
      { label: "BROAD", last: 5_420, close: 5_390, change_pct: 0.44 },
    ],
    ...over,
  };
}

describe("BreadthStrip", () => {
  test("keeps every testid and reports the breadth count", () => {
    render(() => <BreadthStrip data={payload()} />);
    expect(screen.getByTestId("nifty-breadth-strip")).toHaveAttribute("data-up", "4");
    expect(screen.getByTestId("nifty-breadth-count")).toHaveTextContent("4/5 up");
    for (const label of ["nifty", "bank", "mid", "small", "broad"]) {
      expect(screen.getByTestId(`nifty-breadth-${label}`)).toBeInTheDocument();
    }
  });

  test("colours each index by its own sign", () => {
    render(() => <BreadthStrip data={payload()} />);
    const mid = screen.getByTestId("nifty-breadth-mid");
    const small = screen.getByTestId("nifty-breadth-small");
    expect(mid.textContent).toContain("-0.68%");
    expect(small.textContent).toContain("-1.20%");
  });

  test("stays one non-wrapping 24px band", () => {
    render(() => <BreadthStrip data={payload()} />);
    const strip = screen.getByTestId("nifty-breadth-strip");
    expect(strip.className).toContain("whitespace-nowrap");
    expect(strip.className).toContain("overflow-hidden");
    expect(strip.className).toContain("h-6");
    expect(strip.className).not.toContain("flex-wrap");
    expect(strip.className).not.toContain("border ");
  });

  test("renders nothing when the quote path is down", () => {
    render(() => <BreadthStrip data={payload({ available: false })} />);
    expect(screen.queryByTestId("nifty-breadth-strip")).not.toBeInTheDocument();
  });

  test("drops rows without a change so the denominator stays honest", () => {
    const data = payload();
    data.rows = [
      ...data.rows,
      { label: "STALE", last: null, close: null, change_pct: null },
    ];
    render(() => <BreadthStrip data={data} />);
    expect(screen.getByTestId("nifty-breadth-count")).toHaveTextContent("4/5 up");
    expect(screen.queryByTestId("nifty-breadth-stale")).not.toBeInTheDocument();
  });
});
