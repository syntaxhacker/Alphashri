// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot } from "solid-js";
import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { useColorScheme } from "@/ui";
import type { SectorCorrelationResponse } from "../../types/sector";

const { fixture, tanStackRendered, fetchMock } = vi.hoisted(() => {
  const data: SectorCorrelationResponse = {
    sectors: [
      {
        name: "IT",
        beta_vs_index: 1.12,
        relative_strength_5d: 0.4,
        relative_strength_1m: 1.1,
        relative_strength_3m: 2.3,
        rank_current: 1,
        rank_change_1m: 2,
      },
      {
        name: "BANK",
        beta_vs_index: 0.85,
        relative_strength_5d: -0.2,
        relative_strength_1m: 0.3,
        relative_strength_3m: -1.1,
        rank_current: 2,
        rank_change_1m: 0,
      },
      {
        name: "ENERGY",
        beta_vs_index: 1.35,
        relative_strength_5d: 1,
        relative_strength_1m: -0.5,
        relative_strength_3m: 0.2,
        rank_current: 3,
        rank_change_1m: -2,
      },
      {
        name: "PHARMA",
        beta_vs_index: 0.6,
        relative_strength_5d: 0.1,
        relative_strength_1m: 0.2,
        relative_strength_3m: 0.3,
        rank_current: 4,
        rank_change_1m: -1,
      },
      {
        name: "METAL",
        beta_vs_index: 1.05,
        relative_strength_5d: -0.7,
        relative_strength_1m: 0.8,
        relative_strength_3m: -0.4,
        rank_current: 5,
        rank_change_1m: 1,
      },
    ],
    correlation_matrix: [
      [1, 0.6, 0.2, 0.3, 0.5],
      [0.6, 1, 0.4, 0.1, 0.7],
      [0.2, 0.4, 1, 0.2, 0.3],
      [0.3, 0.1, 0.2, 1, 0.2],
      [0.5, 0.7, 0.3, 0.2, 1],
    ],
    sector_names: ["IT", "BANK", "ENERGY", "PHARMA", "METAL"],
    last_updated: "2026-11-16T10:00:00+05:30",
  };
  return {
    fixture: data,
    tanStackRendered: vi.fn(),
    fetchMock: vi.fn(async () => data),
  };
});

vi.mock("../../state/sectorCorrelation", () => ({
  market: "india",
  lookbackDays: 90,
  data: fixture,
  isLoading: false,
  error: null,
  fetchCorrelationData: (...args: unknown[]) => fetchMock(...args),
  setMarket: vi.fn(),
  setLookbackDays: vi.fn(),
  subscribe: () => () => {},
}));

// ECharts needs a real canvas; the heatmap is a boundary, not the contract here.
vi.mock("../../utils/loadEcharts", () => ({ loadEcharts: async () => null }));

vi.mock("../common/TanStackTable", () => ({
  TanStackTable: () => {
    tanStackRendered();
    return <div data-testid="rs-table-stub" />;
  },
}));

import { SectorCorrelationTab } from "./SectorCorrelationTab";

function setScheme(scheme: "light" | "dark") {
  createRoot((dispose) => {
    useColorScheme().setColorScheme(scheme);
    dispose();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  setScheme("light");
});

describe("SectorCorrelationTab theme", () => {
  test("passes dark to every board when the app scheme is dark", () => {
    setScheme("dark");
    render(() => <SectorCorrelationTab />);

    for (const id of [
      "correlation-matrix-board",
      "correlation-beta-dot-plot",
      "correlation-rank-change",
      "correlation-rs-board",
    ]) {
      expect(screen.getByTestId(id)).toHaveAttribute("data-theme", "dark");
    }
  });

  test("passes light when the app scheme is light and repaints on a flip", () => {
    setScheme("light");
    render(() => <SectorCorrelationTab />);
    expect(screen.getByTestId("correlation-beta-dot-plot")).toHaveAttribute("data-theme", "light");

    setScheme("dark");
    expect(screen.getByTestId("correlation-beta-dot-plot")).toHaveAttribute("data-theme", "dark");

    setScheme("light");
    expect(screen.getByTestId("correlation-beta-dot-plot")).toHaveAttribute("data-theme", "light");
  });
});

describe("SectorCorrelationTab layout", () => {
  test("keeps the tab bounded and scrolls only the content column", () => {
    render(() => <SectorCorrelationTab />);

    const root = screen.getByTestId("sector-correlation-tab");
    for (const cls of ["flex-1", "min-h-0", "flex-col", "overflow-hidden"]) {
      expect(root).toHaveClass(cls);
    }

    const header = screen.getByTestId("sector-correlation-header");
    const scroll = screen.getByTestId("sector-correlation-scroll");
    expect(scroll).toHaveClass("flex-1");
    expect(scroll).toHaveClass("min-h-0");
    expect(scroll).toHaveClass("overflow-y-auto");
    expect(scroll).not.toContainElement(header);
    expect(root).toContainElement(header);
  });

  test("stacks one column at 390 without fixed-width panels or horizontal scroll", () => {
    render(() => <SectorCorrelationTab />);

    const scroll = screen.getByTestId("sector-correlation-scroll");
    expect(scroll).toHaveClass("overflow-x-hidden");

    const grid = screen.getByTestId("sector-correlation-grid");
    expect(grid).toHaveClass("grid-cols-1");
    expect(grid).toHaveClass("xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]");
    expect(grid.className).not.toContain("lg:grid-cols-2");
    expect(grid.className).not.toContain("h-[400px]");
    const rightColumn = grid.children[1] as HTMLElement;
    expect(rightColumn).toHaveClass("xl:grid-rows-2");
    expect(rightColumn).toHaveClass("xl:h-full");

    for (const panel of [
      screen.getByTestId("sector-correlation-heatmap"),
      screen.getByTestId("sector-beta-chart"),
      screen.getByTestId("rotation-timeline"),
    ]) {
      expect(panel).toHaveClass("min-w-0");
      expect(panel).toHaveClass("xl:h-full");
      expect(panel.className).not.toMatch(/w-\[\d{4}px\]/);
    }
    expect(screen.getByTestId("relative-strength-table")).toHaveClass("min-w-0");
    expect(screen.getByTestId("correlation-rs-board").className).toContain("min-w-0");
    expect(screen.getByTestId("correlation-rs-row-0").className).toContain("grid-cols-[32px_minmax(0,1fr)]");
  });
});

describe("SectorCorrelationTab ranked boards", () => {
  test("uses a horizontal CSS matrix inside the heatmap panel", () => {
    render(() => <SectorCorrelationTab />);

    const panel = screen.getByTestId("sector-correlation-heatmap");
    const board = screen.getByTestId("correlation-matrix-board");
    expect(panel).toContainElement(board);
    expect(panel.querySelector("table")).toBeNull();
    expect(panel.querySelector("canvas")).toBeNull();
    expect(board.querySelector(".rotate-45")).toBeNull();
    expect(screen.getByTestId("correlation-matrix-header-0")).toHaveAttribute("title", "IT");
    expect(screen.getByTestId("correlation-matrix-cell-0-0")).toHaveAttribute("data-diagonal", "true");
  });

  test("renders the relative-strength board without a TanStack table", () => {
    render(() => <SectorCorrelationTab />);

    const panel = screen.getByTestId("relative-strength-table");
    expect(tanStackRendered).not.toHaveBeenCalled();
    expect(screen.queryByTestId("rs-table-stub")).not.toBeInTheDocument();
    expect(screen.queryByTestId("relative-strength-table-inner")).not.toBeInTheDocument();
    expect(panel.querySelector("table")).toBeNull();

    const row = screen.getByTestId("correlation-rs-row-0");
    expect(row).toHaveTextContent("#1");
    expect(row).toHaveTextContent("IT");
    for (const label of ["5D", "1M", "3M", "Beta", "Δ1M"]) {
      expect(row).toHaveTextContent(label);
    }
    expect(row).toHaveTextContent("+0.40%");
    expect(row).toHaveTextContent("1.12");
    expect(row).toHaveTextContent("+2");
  });

  test("sorts rotation rows by change and marks top-3 ranks", () => {
    render(() => <SectorCorrelationTab />);

    const sectors = [0, 1, 2, 3, 4].map((i) =>
      screen.getByTestId(`correlation-rank-row-${i}`).getAttribute("data-sector"),
    );
    expect(sectors).toEqual(["IT", "METAL", "BANK", "PHARMA", "ENERGY"]);
    expect(screen.getByTestId("correlation-rank-badge-0")).toHaveTextContent("#1");
    expect(screen.getByTestId("correlation-rank-row-0")).toHaveAttribute("data-top3", "true");
    expect(screen.getByTestId("correlation-rank-row-3")).toHaveAttribute("data-sector", "PHARMA");
    expect(screen.getByTestId("correlation-rank-row-3")).toHaveAttribute("data-top3", "false");
    expect(screen.getByTestId("correlation-rank-value-0")).toHaveTextContent("+2");
    expect(screen.getByTestId("correlation-rank-value-4")).toHaveTextContent("-2");
    expect(screen.getByTestId("correlation-rank-rail-2")).toBeInTheDocument();
    expect(screen.queryByTestId("correlation-rank-bar-2")).not.toBeInTheDocument();
  });

  test("sorts beta rows and draws the 1.0 reference rail with direct labels", () => {
    render(() => <SectorCorrelationTab />);

    const sectors = [0, 1, 2, 3, 4].map((i) =>
      screen.getByTestId(`correlation-beta-row-${i}`).getAttribute("data-sector"),
    );
    expect(sectors).toEqual(["ENERGY", "IT", "METAL", "BANK", "PHARMA"]);
    expect(screen.getByTestId("correlation-beta-rail-label")).toHaveTextContent("1.0");
    expect(screen.getByTestId("correlation-beta-dot-0")).toBeInTheDocument();
    expect(screen.getByTestId("correlation-beta-value-0")).toHaveTextContent("1.35");
    expect(screen.getByTestId("correlation-beta-row-0")).toHaveTextContent("ENERGY");
    expect(screen.getByTestId("correlation-beta-row-0")).toHaveAttribute("data-beta", "1.35");
  });

  test("sector rows are display rows, not chart affordances", () => {
    render(() => <SectorCorrelationTab />);

    for (const row of [
      screen.getByTestId("correlation-rank-row-0"),
      screen.getByTestId("correlation-beta-row-0"),
      screen.getByTestId("correlation-rs-row-2"),
    ]) {
      expect(row.tagName).toBe("DIV");
      expect(row).not.toHaveAttribute("role");
      expect(row).not.toHaveAttribute("tabindex");
      expect(row.className).not.toContain("cursor-pointer");
      expect(row.className).not.toContain("focus-visible");
      expect(row.querySelector("button")).toBeNull();
    }
    expect(screen.getByTestId("correlation-rs-row-2")).toHaveAttribute("data-sector", "ENERGY");
  });

  test("panel titles and benchmark stay direct and readable", () => {
    render(() => <SectorCorrelationTab />);

    expect(
      within(screen.getByTestId("rotation-timeline")).getByText(
        "Sector Rotation (1-Month Rank Change)",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("sector-beta-chart")).getByText("Beta vs Benchmark · NIFTY 50"),
    ).toBeInTheDocument();
  });
});
