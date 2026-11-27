// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import type { RotationRow } from "../../../types/rotation";
import { MultiPeriodHeatmap } from "./MultiPeriodHeatmap";
import { RankedBoard } from "./RankedBoard";

const returns = {
  "1D": 1,
  "1W": 2,
  "1M": 3,
  "3M": 4,
  "6M": 5,
  YTD: 6,
  "1Y": 7,
};

const ROWS: RotationRow[] = [
  {
    id: "sector:test",
    name: "Test Sector",
    kind: "sector",
    category: "Test",
    members: 10,
    covered: 10,
    returns,
    rs_1m: 1,
    rs_1w: 1,
    rs_pct: 60,
    mom_pct: 60,
    rank: 1,
    rank_delta: 1,
    breadth: 60,
    rel_volume: 1,
    quadrant: "leading",
    status: "booming",
    top_movers: [],
  },
];

function makeScrollable(element: HTMLElement, { height = 500, viewport = 200 } = {}) {
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: height,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: viewport,
  });
  element.scrollTop = 0;
}

afterEach(() => cleanup());

describe("rotation roster scroll cues", () => {
  test("multi-period shows a bottom cue until the reader reaches the end", () => {
    render(() => (
      <MultiPeriodHeatmap rows={ROWS} selectedId={null} onSelect={() => {}} />
    ));
    const scroller = screen.getByTestId("rotation-matrix-rows");
    makeScrollable(scroller);
    fireEvent.scroll(scroller);
    expect(screen.getByTestId("rotation-matrix-scroll-cue")).toHaveTextContent("Scroll ↓");

    scroller.scrollTop = 300;
    fireEvent.scroll(scroller);
    expect(screen.queryByTestId("rotation-matrix-scroll-cue")).not.toBeInTheDocument();
  });

  test("ranked board shows a bottom cue until the reader reaches the end", () => {
    render(() => (
      <RankedBoard rows={ROWS} selectedId={null} onSelect={() => {}} period="1M" />
    ));
    const scroller = screen.getByTestId("rotation-board-scroller");
    makeScrollable(scroller);
    fireEvent.scroll(scroller);
    expect(screen.getByTestId("rotation-board-scroll-cue")).toHaveTextContent("Scroll ↓");

    scroller.scrollTop = 300;
    fireEvent.scroll(scroller);
    expect(screen.queryByTestId("rotation-board-scroll-cue")).not.toBeInTheDocument();
  });
});
