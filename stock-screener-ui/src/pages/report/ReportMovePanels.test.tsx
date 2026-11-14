// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, test } from "vitest";
import { ReportMovePanels } from "./ReportMovePanels";
import type { DailyMoveRow } from "../../types/report";

afterEach(cleanup);

function row(over: Partial<DailyMoveRow> = {}): DailyMoveRow {
  return {
    symbol: "RELIANCE",
    name: "Reliance Industries",
    close: 2_945.5,
    change: 2.14,
    spark: [0.2, 0.4, 0.6, 0.9],
    ...over,
  };
}

describe("ReportMovePanels", () => {
  test("renders one flush panel per move group and keeps the panel testids", () => {
    render(() => <ReportMovePanels moves={{ gainers: [row()], losers: [row({ symbol: "INFY", change: -1.4 })] }} />);
    for (const id of ["gainers", "losers", "volume_surge", "gap_up", "gap_down"]) {
      expect(screen.getByTestId(`report-moves-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("report-moves-gainers-title")).toHaveTextContent("Top gainers");
    expect(screen.getByTestId("report-moves-gainers-count")).toHaveTextContent("1");
  });

  test("panel is flush — the body carries no second border or padding", () => {
    render(() => <ReportMovePanels moves={{ gainers: [row()] }} />);
    const panel = screen.getByTestId("report-moves-gainers");
    expect(panel.className).not.toContain("border ");
    expect(within(panel).getByTestId("report-moves-gainers-rows").className).not.toContain("px-2");
  });

  test("rows are separated by a 1px divider, never a gap", () => {
    render(() => (
      <ReportMovePanels moves={{ gainers: [row(), row({ symbol: "TCS", change: -0.6 })] }} />
    ));
    const rows = within(screen.getByTestId("report-moves-gainers-rows")).getAllByTestId(/report-move-row-/);
    expect(rows).toHaveLength(2);
    for (const el of rows) {
      expect(el.className).toContain("border-b");
      expect(el.className).not.toContain("gap-4");
    }
    expect(rows[0].className).not.toContain("gap-2");
  });

  test("counts a change with its sign colour and mono numerals", () => {
    render(() => <ReportMovePanels moves={{ gainers: [row()] }} />);
    const gain = screen.getByTestId("report-move-row-RELIANCE");
    expect(gain).toHaveTextContent("+2.14%");
    expect(gain.textContent).toContain("₹2945.50");
    expect(gain.querySelector(".tabular-nums")).not.toBeNull();
  });

  test("shows the empty state inside the same panel", () => {
    render(() => <ReportMovePanels moves={{ gap_up: [] }} />);
    expect(screen.getByTestId("report-moves-gap_up-empty")).toHaveTextContent("No stocks qualify");
    expect(screen.queryByTestId("report-moves-gap_up-rows")).not.toBeInTheDocument();
  });

  test("tolerates a null moves payload", () => {
    render(() => <ReportMovePanels moves={null} />);
    expect(screen.getByTestId("report-moves-gainers-empty")).toBeInTheDocument();
  });
});
