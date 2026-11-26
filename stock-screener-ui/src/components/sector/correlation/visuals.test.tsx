// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import type { SectorCorrelationResponse } from "../../../types/sector";
import { BetaDotPlot } from "./BetaDotPlot";
import { RankChangeBoard } from "./RankChangeBoard";
import {
  betaRows,
  rankChangeRows,
  signed,
  strengthRows,
  type CorrelationSector,
} from "./model";
import { RelativeStrengthBoard } from "./RelativeStrengthBoard";

type Row = SectorCorrelationResponse["sectors"][number];

function sector(name: string, rank: number, change: number, beta: number): Row {
  return {
    name,
    rank_current: rank,
    rank_change_1m: change,
    beta_vs_index: beta,
    relative_strength_5d: 0.5,
    relative_strength_1m: -0.5,
    relative_strength_3m: 1.5,
  };
}

const ROWS: CorrelationSector[] = [
  sector("FALL", 6, -3, 0.7),
  sector("TOP", 1, 2, 1.2),
  sector("FLAT", 4, 0, 1),
  sector("RISE", 3, 1, 0.9),
];

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("board ordering helpers", () => {
  test("rotation is descending by change, beta descending, rankings by current rank", () => {
    expect(rankChangeRows(ROWS).map((row) => row.name)).toEqual([
      "TOP",
      "RISE",
      "FLAT",
      "FALL",
    ]);
    expect(betaRows(ROWS).map((row) => row.name)).toEqual([
      "TOP",
      "FLAT",
      "RISE",
      "FALL",
    ]);
    expect(strengthRows(ROWS).map((row) => row.name)).toEqual([
      "TOP",
      "RISE",
      "FLAT",
      "FALL",
    ]);
    expect(ROWS[0]).toEqual(sector("FALL", 6, -3, 0.7));
  });

  test("signs values without inventing a sector-to-symbol mapping", () => {
    expect(signed(2)).toBe("+2");
    expect(signed(0)).toBe("0");
    expect(signed(-3)).toBe("-3");
  });
});

describe("RankChangeBoard", () => {
  test("draws bars from the zero rail and labels the value at the bar end", () => {
    render(() => <RankChangeBoard sectors={ROWS} isDark={false} />);

    expect(screen.getByTestId("correlation-rank-row-0")).toHaveAttribute("data-sector", "TOP");
    expect(screen.getByTestId("correlation-rank-bar-0").style.left).toBe("50%");
    expect(screen.getByTestId("correlation-rank-bar-0").style.right).toBe("");
    expect(screen.getByTestId("correlation-rank-bar-3").style.right).toBe("50%");
    expect(screen.getByTestId("correlation-rank-bar-3").style.left).toBe("");
    expect(screen.getByTestId("correlation-rank-value-0")).toHaveTextContent("+2");
    expect(screen.getByTestId("correlation-rank-value-3")).toHaveTextContent("-3");
    expect(screen.getByTestId("correlation-rank-rail-2")).toBeInTheDocument();
    expect(screen.queryByTestId("correlation-rank-bar-2")).not.toBeInTheDocument();
  });

  test("rows stay display-only: sector labels are not chart symbols", () => {
    render(() => <RankChangeBoard sectors={ROWS} isDark={false} />);
    const row = screen.getByTestId("correlation-rank-row-0");
    expect(row.tagName).toBe("DIV");
    expect(row).not.toHaveAttribute("tabindex");
    expect(row.querySelector("button")).toBeNull();
  });
});

describe("BetaDotPlot", () => {
  test("keeps 1.0 inside the domain and puts the stem on the right side for beta above 1", () => {
    render(() => <BetaDotPlot sectors={ROWS} benchmark="NIFTY 50" isDark={true} />);

    expect(screen.getByTestId("correlation-beta-row-0")).toHaveAttribute("data-sector", "TOP");
    const rail = screen.getByTestId("correlation-beta-rail-0").style.left;
    const dot = screen.getByTestId("correlation-beta-dot-0").style.left;
    expect(Number.parseFloat(rail)).toBeLessThan(Number.parseFloat(dot));
    expect(screen.getByTestId("correlation-beta-stem-0").style.left).toBe(rail);
    expect(screen.getByTestId("correlation-beta-value-0")).toHaveTextContent("1.20");
    expect(screen.getByTestId("correlation-beta-dot-plot")).toHaveAttribute("data-theme", "dark");
  });

  test("rows stay display-only and keep their value labels", () => {
    render(() => <BetaDotPlot sectors={ROWS} benchmark="SPY" isDark={false} />);
    const row = screen.getByTestId("correlation-beta-row-1");
    expect(row.tagName).toBe("DIV");
    expect(row).not.toHaveAttribute("tabindex");
    expect(screen.getByTestId("correlation-beta-value-1")).toHaveTextContent("1.00");
  });
});

describe("RelativeStrengthBoard", () => {
  test("self-labels every value on a display-only row", () => {
    render(() => <RelativeStrengthBoard sectors={ROWS} isDark={false} />);

    const row = screen.getByTestId("correlation-rs-row-0");
    expect(row).toHaveAttribute("data-sector", "TOP");
    expect(row).toHaveTextContent("+0.50%");
    expect(row).toHaveTextContent("-0.50%");
    expect(row).toHaveTextContent("+1.50%");
    expect(row).toHaveTextContent("1.20");
    expect(row).toHaveTextContent("+2");
    expect(row.className).not.toContain("rotate");
    expect(row.tagName).toBe("DIV");
    expect(row).not.toHaveAttribute("tabindex");
  });
});
