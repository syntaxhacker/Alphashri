// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { HistoryLab } from "./HistoryLab";
import type { SectorHistorySeries } from "../../../types/sectorHistory";

const chartHosts = vi.hoisted(
  () => [] as Array<{ id: string; style: Record<string, unknown> }>,
);

vi.mock("../../common/EChart", () => ({
  EChart: (props: { style?: Record<string, unknown>; "data-testid"?: string }) => {
    chartHosts.push({ id: props["data-testid"] ?? "", style: props.style ?? {} });
    const node = document.createElement("div");
    node.setAttribute("data-testid", props["data-testid"] ?? "");
    return node;
  },
}));

const MONTHS = Array.from({ length: 24 }, (_, index) => {
  const year = 2024 + Math.floor(index / 12);
  return `${year}-${String((index % 12) + 1).padStart(2, "0")}`;
});

function series(name: string, benchmark = false): SectorHistorySeries {
  return {
    name,
    is_benchmark: benchmark,
    monthly_returns: MONTHS.map((_, index) => (index % 4) - 1),
    ranks: benchmark ? MONTHS.map(() => null) : MONTHS.map((_, index) => (index % 3) + 1),
  };
}

afterEach(() => {
  cleanup();
  chartHosts.length = 0;
});

describe("HistoryLab chart-host height contract", () => {
  test("every ECharts host carries a positive fixed height and never flexes to 0", () => {
    render(() => (
      <HistoryLab
        market="india"
        years={5}
        months={MONTHS}
        series={[series("NIFTY 50", true), series("NIFTY IT")]}
        universe={["NIFTY IT"]}
        seasonality={MONTHS.flatMap((_, month) => [
          { name: "NIFTY IT", month: month + 1, avg_return: 1, hit_rate: 0.5, n: 5 },
        ])}
        transitionN={5}
      />
    ));

    expect(
      screen.getByTestId("sector-history-lab-sankey-panel"),
    ).toBeInTheDocument();
    // Every ECharts surface that is mounted by the lab must carry its own
    // positive height. The SVG movers panel is intentionally not in this list.
    for (const id of [
      "history-rank-transition-sankey",
      "history-underwater-chart",
      "history-seasonality-radial-chart",
      "history-relative-strength-chart",
      "history-rs-trail-chart",
    ]) {
      const host = chartHosts.find((entry) => entry.id === id);
      expect(host, `${id} host was not rendered`).toBeDefined();
      const height = Number.parseFloat(String(host!.style.height));
      expect(Number.isFinite(height)).toBe(true);
      expect(height).toBeGreaterThan(0);
      expect(host!.style.flex).toBe("none");
    }
  });
});
