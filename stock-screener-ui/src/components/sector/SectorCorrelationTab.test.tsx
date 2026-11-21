// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createRoot } from "solid-js";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { useColorScheme } from "@/ui";
import type { SectorCorrelationResponse } from "../../types/sector";

const { fixture } = vi.hoisted(() => {
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
    ],
    correlation_matrix: [[1]],
    sector_names: ["IT"],
    last_updated: "2026-11-16T10:00:00+05:30",
  };
  return { fixture: data };
});

vi.mock("../../state/sectorCorrelation", () => ({
  market: "india",
  lookbackDays: 90,
  data: fixture,
  isLoading: false,
  error: null,
  fetchCorrelationData: vi.fn(),
  setMarket: vi.fn(),
  setLookbackDays: vi.fn(),
  subscribe: () => () => {},
}));

// The chart bodies are ECharts canvases; the contract under test is the theme
// flag the tab hands them, so render it as an attribute the test can read.
vi.mock("./SectorCorrelationCharts", () => ({
  CorrelationHeatmap: () => <div data-testid="heatmap-stub" />,
  SectorBetaChart: (props: { isDark?: boolean }) => (
    <div data-testid="beta-stub" data-is-dark={String(Boolean(props.isDark))} />
  ),
  RotationTimeline: (props: { isDark?: boolean }) => (
    <div data-testid="rotation-stub" data-is-dark={String(Boolean(props.isDark))} />
  ),
}));

vi.mock("../common/TanStackTable", () => ({
  TanStackTable: () => <div data-testid="rs-table-stub" />,
}));

import { SectorCorrelationTab } from "./SectorCorrelationTab";

function setScheme(scheme: "light" | "dark") {
  createRoot((dispose) => {
    useColorScheme().setColorScheme(scheme);
    dispose();
  });
}

afterEach(() => {
  cleanup();
  setScheme("light");
});

describe("SectorCorrelationTab theme", () => {
  /**
   * The theme flag was read from a `data-dark` attribute nothing writes, so
   * every chart in this tab was permanently light.
   */
  test("passes dark to both charts when the app scheme is dark", () => {
    setScheme("dark");
    render(() => <SectorCorrelationTab />);

    expect(screen.getByTestId("beta-stub")).toHaveAttribute("data-is-dark", "true");
    expect(screen.getByTestId("rotation-stub")).toHaveAttribute("data-is-dark", "true");
  });

  test("passes light when the app scheme is light", () => {
    setScheme("light");
    render(() => <SectorCorrelationTab />);

    expect(screen.getByTestId("beta-stub")).toHaveAttribute("data-is-dark", "false");
    expect(screen.getByTestId("rotation-stub")).toHaveAttribute("data-is-dark", "false");
  });

  test("repaints the charts when the scheme flips while mounted", () => {
    setScheme("light");
    render(() => <SectorCorrelationTab />);
    expect(screen.getByTestId("beta-stub")).toHaveAttribute("data-is-dark", "false");

    setScheme("dark");
    expect(screen.getByTestId("beta-stub")).toHaveAttribute("data-is-dark", "true");

    setScheme("light");
    expect(screen.getByTestId("beta-stub")).toHaveAttribute("data-is-dark", "false");
  });
});
