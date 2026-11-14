// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, test } from "vitest";
import { BreadthStat, LeaderStrip } from "./ReportLeaderStrip";
import type { SectorLeader } from "../../types/report";

afterEach(cleanup);

const leader = (name: string, change: number): SectorLeader => ({
  name,
  change,
  stock_count: 12,
  advances: change >= 0 ? 9 : 3,
  declines: change >= 0 ? 3 : 9,
});

describe("BreadthStat", () => {
  test("renders label above a mono right-aligned value", () => {
    render(() => <BreadthStat label="Adv" value="320" testId="report-breadth-advances" color="success" />);
    const cell = screen.getByTestId("report-breadth-advances");
    expect(cell).toHaveTextContent("Adv");
    expect(cell).toHaveTextContent("320");
    expect(cell.className).toContain("px-2");
    expect(cell.className).toContain("border-l");
    expect(cell.className).toContain("first:border-l-0");
    expect(cell.style.fontVariantNumeric).toBe("tabular-nums");
  });

  test("is a borderless cell, not its own card", () => {
    render(() => <BreadthStat label="Avg" value="+1.20%" testId="report-breadth-avg" />);
    const cell = screen.getByTestId("report-breadth-avg");
    expect(cell.className).not.toContain("rounded");
    expect(cell.className).not.toContain("bg-fin-surface");
  });
});

describe("LeaderStrip", () => {
  const board = { top: [leader("Energy", 2.1)], bottom: [leader("IT", -1.4)] };

  test("renders both sides of the board with their testids", () => {
    render(() => <LeaderStrip leaders={board} testId="report-sector-leaders" label="Sectors" />);
    const strip = screen.getByTestId("report-sector-leaders");
    expect(strip).toHaveTextContent("Sectors");
    expect(strip).toHaveTextContent("1 up · 1 down");
    expect(screen.getByTestId("report-sector-leaders-item-Energy")).toHaveTextContent("+2.10%");
    expect(screen.getByTestId("report-sector-leaders-item-IT")).toHaveTextContent("-1.40%");
  });

  test("has no outer border — the page panel owns it", () => {
    render(() => <LeaderStrip leaders={board} testId="report-sector-leaders" label="Sectors" />);
    expect(screen.getByTestId("report-sector-leaders").className).not.toContain("border border");
  });

  test("splits a flat array into winners and losers", () => {
    render(() => (
      <LeaderStrip
        leaders={[leader("PSU", 1.2), leader("Midcap", -0.6)]}
        testId="report-theme-leaders"
        label="Themes"
      />
    ));
    expect(screen.getByTestId("report-theme-leaders-item-PSU")).toHaveTextContent("+1.20%");
    expect(screen.getByTestId("report-theme-leaders-item-Midcap")).toHaveTextContent("-0.60%");
  });

  test("rows carry a 1px divider instead of a gap", () => {
    render(() => (
      <LeaderStrip leaders={{ top: [leader("Energy", 2.1), leader("Metal", 1.1)], bottom: [] }} testId="report-sector-leaders" label="Sectors" />
    ));
    const strip = screen.getByTestId("report-sector-leaders");
    for (const name of ["Energy", "Metal"]) {
      const row = screen.getByTestId(`report-sector-leaders-item-${name}`);
      expect(row.className).toContain("border-b");
      expect(row.className).not.toContain("gap-4");
    }
    expect(within(strip).queryAllByText(/Energy|Metal/)).not.toHaveLength(0);
  });

  test("renders nothing without usable leaders", () => {
    render(() => <LeaderStrip leaders={undefined} testId="report-sector-leaders" label="Sectors" />);
    expect(screen.queryByTestId("report-sector-leaders")).not.toBeInTheDocument();
  });
});
