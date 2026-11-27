// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import type {
  SectorHistoryMarket,
  SectorHistoryResponse,
  SectorHistorySeries,
} from "../../../types/sectorHistory";
import { SectorHistoryTab } from "./SectorHistoryTab";

const { fetchMock, charts } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  charts: [] as unknown[],
}));

vi.mock("../../../api/sectorHistory", () => ({
  fetchSectorHistory: (...args: unknown[]) => fetchMock(...args),
}));

vi.mock("../../common/EChart", () => ({
  EChart: (props: { option?: unknown; "data-testid"?: string }) => {
    charts.push(props.option);
    const el = document.createElement("div");
    if (props["data-testid"]) el.setAttribute("data-testid", props["data-testid"]);
    return el;
  },
}));

const MONTHS = ["2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12"];
const BASE_NAMES = ["Technology", "Banking", "Energy"];

function fixture(market: SectorHistoryMarket, years: number): SectorHistoryResponse {
  const names = BASE_NAMES.map((name) => (market === "america" ? `US ${name}` : name));
  const series: SectorHistorySeries[] = names.map((name, index) => ({
    name,
    is_benchmark: false,
    monthly_returns: MONTHS.map((_, month) => ((index + month) % 7) - 3),
    ranks: MONTHS.map((_, month) => ((index + month) % 3) + 1),
  }));
  series.push({
    name: market === "america" ? "S&P 500" : "NIFTY 50",
    is_benchmark: true,
    monthly_returns: MONTHS.map(() => 1),
    ranks: MONTHS.map(() => null),
  });
  return {
    market,
    years,
    cached: market === "america",
    months: MONTHS,
    as_of: market === "america" ? `2027-${String(years).padStart(2, "0")}-28` : "2026-06-30",
    last_updated: "2026-01-01T00:00:00Z",
    source: "fixture",
    disclaimer: "Past performance is not indicative of future results.",
    universe: names,
    series,
    risk: names.map((name, index) => ({
      name,
      max_drawdown: -10 - index,
      current_drawdown: index === 0 ? -2 : 0,
      recovery_days: index,
      sharpe: index === 2 ? null : 0.5 + index,
      volatility: index === 2 ? null : 15 + index,
    })),
    seasonality: names.flatMap((name) =>
      Array.from({ length: 12 }, (_, month) => ({
        name,
        month: month + 1,
        avg_return: ((month + name.length) % 5) - 2,
        hit_rate: 0.5,
        n: years,
      })),
    ),
    persistence: {
      by_sector: [],
      transition_matrix: [
        [0.6, 0.3, 0.1],
        [0.2, 0.5, 0.3],
        [0.1, 0.2, 0.7],
      ],
    },
  };
}

function select(testId: string) {
  return within(screen.getByTestId(testId)).getByRole("combobox");
}

function labTitle(testId: string) {
  return within(screen.getByTestId(testId)).getByTestId("history-panel-title");
}

const LAB_PANELS = [
  ["sector-history-lab-sankey-panel", "Rank transitions"],
  ["sector-history-lab-movers-panel", "Monthly movers"],
  ["sector-history-lab-drawdown-panel", "Monthly drawdown"],
  ["sector-history-lab-seasonality-panel", "Seasonality"],
  ["sector-history-lab-rs-panel", "Relative strength"],
  ["sector-history-lab-trail-panel", "RS momentum trail"],
] as const;

describe("SectorHistoryTab composed render", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    charts.length = 0;
    fetchMock.mockImplementation(
      ({ market, years }: { market: SectorHistoryMarket; years: number }) =>
        Promise.resolve(fixture(market, years)),
    );
  });

  afterEach(() => cleanup());

  test("renders the real overview, rotation lab, and follows market/years changes", async () => {
    const [market, setMarket] = createSignal<SectorHistoryMarket>("india");
    renderWithProviders(() => <SectorHistoryTab market={market()} />);
    await screen.findByTestId("history-rank-heatmap");
    for (const testId of [
      "history-seasonality",
      "history-persistence",
      "history-rotation-timeline",
      "sector-history-risk-table",
    ]) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
    expect(charts.length).toBeGreaterThan(0);
    expect(
      (charts as Array<Record<string, unknown>>).some((option) => Array.isArray(option.series)),
    ).toBe(true);
    expect(
      within(screen.getByTestId("sector-history-rank-panel")).getByTestId("status"),
    ).toHaveTextContent("3 sectors · monthly rank · 2025-07 → 2025-12");
    const rankScroller = screen.getByTestId("sector-history-rank-scroll");
    expect(rankScroller).not.toContainElement(screen.getByTestId("history-rank-aside"));
    expect(screen.getByTestId("sector-history-rank-panel")).toContainElement(
      screen.getByTestId("history-rank-aside"),
    );

    fireEvent.click(
      within(screen.getByTestId("sector-history-view-toggle")).getByText("Rotation Lab"),
    );
    for (const [testId, title] of LAB_PANELS) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
      expect(labTitle(testId)).toHaveTextContent(title);
    }
    expect(labTitle("sector-history-lab-drawdown-panel")).toHaveTextContent(
      "Monthly drawdown · Banking",
    );
    expect(labTitle("sector-history-lab-rs-panel")).toHaveTextContent(
      "Relative strength · Banking vs NIFTY 50",
    );
    expect(screen.getByTestId("history-rank-transition")).toBeInTheDocument();
    const sectorSelect = select("sector-history-lab-sector");
    expect(
      within(screen.getByTestId("sector-history-lab-sector")).getAllByRole("option"),
    ).toHaveLength(3);
    expect(sectorSelect).toHaveValue("Banking");

    setMarket("america");
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ market: "america", years: 5 }),
      ),
    );
    await waitFor(() =>
      expect(labTitle("sector-history-lab-drawdown-panel")).toHaveTextContent(
        "Monthly drawdown · US Banking",
      ),
    );
    await waitFor(() =>
      expect(labTitle("sector-history-lab-rs-panel")).toHaveTextContent(
        "Relative strength · US Banking vs S&P 500",
      ),
    );

    fireEvent.input(select("sector-history-years"), { target: { value: "10" } });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ market: "america", years: 10 }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("sector-history-asof")).toHaveTextContent("2025-12-31"),
    );
    expect(labTitle("sector-history-lab-sankey-panel")).toBeVisible();
  });

  test("keeps a malformed payload in the empty state", async () => {
    fetchMock.mockResolvedValue({});
    renderWithProviders(() => <SectorHistoryTab market="india" />);
    expect(await screen.findByTestId("sector-history-empty")).toHaveTextContent(
      "No sector history",
    );
    expect(screen.queryByTestId("sector-history-error")).not.toBeInTheDocument();
  });
});
