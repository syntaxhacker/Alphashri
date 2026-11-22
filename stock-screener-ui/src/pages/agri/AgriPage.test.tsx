// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createMemoryHistory, MemoryRouter, Route, useSearchParams } from "@solidjs/router";
import type { AgriFiltersResponse, AgriPricesResponse } from "@/types/agri";
import { fetchAgriFilters, fetchAgriPrices } from "@/api/agri";
import { agriColumns } from "./agriColumns";
import { AgriPage } from "./AgriPage";

const harness = vi.hoisted(() => ({ lastOption: undefined as Record<string, any> | undefined }));

vi.mock("@/api/agri", () => ({
  fetchAgriFilters: vi.fn(),
  fetchAgriPrices: vi.fn(),
}));

vi.mock("@/components/common/EChart", async () => {
  const { createEffect } = await import("solid-js");
  return {
    EChart: (props: { option: Record<string, any>; "data-testid"?: string }) => {
      createEffect(() => {
        harness.lastOption = props.option;
      });
      return <div data-testid={props["data-testid"] ?? "agri-chart"} />;
    },
  };
});

const filtersPayload: AgriFiltersResponse = {
  ok: true,
  as_of: "2026-11-17",
  freshness_days: 2,
  commodities: [
    { key: "rice", label: "Rice", group: "cereals", unit: "INR/quintal" },
    { key: "wheat", label: "Wheat", group: "cereals", unit: "INR/quintal" },
    { key: "onion", label: "Onion", group: "vegetables", unit: "INR/quintal" },
    { key: "tomato", label: "Tomato", group: "vegetables", unit: "INR/quintal" },
  ],
  groups: [
    { key: "cereals", label: "Cereals" },
    { key: "vegetables", label: "Vegetables" },
  ],
  // The backend currently sends flat name strings; the page must accept both.
  states: ["Maharashtra", "Karnataka"] as unknown as AgriFiltersResponse["states"],
  districts: ["Nashik", "Pune", "Kolar"] as unknown as AgriFiltersResponse["districts"],
  markets: ["Lasalgaon", "Nashik", "Kolar"] as unknown as AgriFiltersResponse["markets"],
};

function pricesPayload(overrides: Partial<AgriPricesResponse> = {}): AgriPricesResponse {
  return {
    ok: true,
    as_of: "2026-11-17",
    freshness_days: 2,
    data_source: "db",
    filters: { commodity: "onion", range: "6m" },
    kpis: {
      modal: 2150,
      min: 1980,
      max: 2310,
      unit: "INR/quintal",
      chg_1w_pct: 1.2,
      chg_1m_pct: -3.4,
      chg_6m_pct: 8.9,
      market_count: 42,
      arrivals_qtl: 18340,
      arrivals_unit: "qtl",
      msp: 2185,
      distance_to_msp_pct: -1.6,
    },
    series: [
      { date: "2026-11-10", modal: 2124, min: 1900, max: 2300, arrivals_qtl: 900, market_count: 40 },
      { date: "2026-11-17", modal: 2150, min: 1980, max: 2310, arrivals_qtl: 1200, market_count: 42 },
    ],
    snapshot: [],
    quotes: [
      {
        date: "2026-11-17",
        state: "Maharashtra",
        district: "Nashik",
        market: "Lasalgaon",
        variety: "Onion",
        grade: "A",
        min: 1980,
        modal: 2150,
        max: 2310,
        arrivals_qtl: 1200,
      },
      {
        date: "2026-11-17",
        state: "Karnataka",
        district: "Kolar",
        market: "Kolar",
        variety: "Onion",
        grade: "A",
        min: 2000,
        modal: 2200,
        max: 2400,
        arrivals_qtl: 300,
      },
    ],
    comparison: [
      {
        key: "wheat",
        label: "Wheat",
        points: [
          { date: "2026-11-10", modal: 2400 },
          { date: "2026-11-17", modal: 2450 },
        ],
      },
    ],
    warnings: [],
    ...overrides,
  };
}

function UrlProbe() {
  const [params] = useSearchParams();
  return <div data-testid="url-probe" data-url={JSON.stringify(params)} />;
}

function renderPage(url = "/agri") {
  const history = createMemoryHistory();
  history.set({ value: url });
  render(() => (
    <MemoryRouter history={history}>
      <Route
        path="/agri"
        component={() => (
          <>
            <AgriPage />
            <UrlProbe />
          </>
        )}
      />
    </MemoryRouter>
  ));
  return history;
}

const urlParams = (): Record<string, string> =>
  JSON.parse(screen.getByTestId("url-probe").getAttribute("data-url") ?? "{}") as Record<string, string>;

const lastParams = () => {
  const calls = vi.mocked(fetchAgriPrices).mock.calls;
  return calls[calls.length - 1]?.[0] as Record<string, unknown>;
};

async function settled() {
  await waitFor(() => expect(fetchAgriPrices).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByTestId("agri-loading")).not.toBeInTheDocument());
}

const optionSeries = () => (harness.lastOption?.series ?? []) as Array<{ type?: string; name?: string }>;
const tooltipHtml = () => {
  const formatter = (harness.lastOption?.tooltip as { formatter?: (params: unknown) => string } | undefined)?.formatter;
  return formatter ? formatter([{ dataIndex: 0 }]) : "";
};

function selectEl(testId: string): HTMLSelectElement {
  const native = screen.getByTestId(testId).querySelector("select");
  if (!native) throw new Error(`no native select inside ${testId}`);
  return native as HTMLSelectElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.lastOption = undefined;
  vi.mocked(fetchAgriFilters).mockResolvedValue(filtersPayload);
  vi.mocked(fetchAgriPrices).mockResolvedValue(pricesPayload());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AgriPage initial load", () => {
  it("loads filters first, then prices with the default commodity and 6m range", async () => {
    renderPage();
    await settled();

    expect(fetchAgriFilters).toHaveBeenCalledTimes(1);
    expect(lastParams()).toMatchObject({ commodity: "onion", range: "6m" });
    expect(screen.getByTestId("agri-freshness")).toHaveAttribute("data-tone", "warning");
    expect(screen.getByTestId("agri-quotes-table")).toBeInTheDocument();
    expect(screen.getByTestId("agri-chart")).toBeInTheDocument();
    expect(screen.getByTestId("agri-scan-group")).toBeInTheDocument();
    expect(screen.getByTestId("agri-range-group")).toBeInTheDocument();
    expect(screen.getByTestId("agri-geo-group")).toBeInTheDocument();
    expect(screen.getByTestId("agri-kpi-head")).toHaveTextContent("Prices ₹/quintal · arrivals qtl");
    expect(screen.getByTestId("agri-table-panel")).toHaveTextContent("Latest mandi quotes");
  });

  it("renders KPI values and units from the payload", async () => {
    renderPage();
    await settled();

    expect(screen.getByTestId("agri-kpi-modal")).toHaveTextContent("₹2,150");
    expect(screen.getByTestId("agri-kpi-chg1w")).toHaveTextContent("+1.2%");
    expect(screen.getByTestId("agri-kpi-chg1m")).toHaveTextContent("-3.4%");
    expect(screen.getByTestId("agri-kpi-chg6m")).toHaveTextContent("+8.9%");
    expect(screen.getByTestId("agri-kpi-range")).toHaveTextContent("₹1,980–₹2,310");
    expect(screen.getByTestId("agri-kpi-markets")).toHaveTextContent("42");
    expect(screen.getByTestId("agri-kpi-arrivals")).toHaveTextContent("18.3K qtl");
    expect(screen.getByTestId("agri-kpi-msp")).toHaveTextContent("₹2,185");
    expect(screen.getByTestId("agri-kpi-msp")).toHaveTextContent("-1.6%");
  });

  it("hydrates every selection from a shareable URL", async () => {
    renderPage("/agri?commodity=wheat&group=cereals&state=Karnataka&district=Kolar&market=Kolar&range=1m&mode=distribution");
    await settled();

    expect(lastParams()).toMatchObject({
      commodity: "wheat",
      group: "cereals",
      state: "Karnataka",
      district: "Kolar",
      market: "Kolar",
      range: "1m",
    });
    expect(optionSeries().some((series) => series.type === "boxplot")).toBe(true);
  });
});

describe("AgriPage filters", () => {
  it("refetches when the commodity changes", async () => {
    renderPage();
    await settled();

    fireEvent.input(selectEl("agri-commodity-select"), { target: { value: "wheat" } });
    await waitFor(() => expect(lastParams().commodity).toBe("wheat"));
  });

  it("narrows the commodity list and refetches when the group changes", async () => {
    renderPage();
    await settled();

    fireEvent.input(selectEl("agri-group-select"), { target: { value: "cereals" } });
    await waitFor(() => expect(lastParams().group).toBe("cereals"));
    expect(lastParams().commodity).toBe("rice");

    const options = within(screen.getByTestId("agri-commodity-select"));
    expect(options.getByRole("option", { name: "Wheat" })).toBeInTheDocument();
    expect(options.queryByRole("option", { name: "Onion" })).not.toBeInTheDocument();
  });

  it("refetches with the chosen range", async () => {
    renderPage();
    await settled();

    fireEvent.click(screen.getByTestId("agri-range-1m"));
    await waitFor(() => expect(lastParams().range).toBe("1m"));
  });

  it("cascades state → district → market and resets deeper levels", async () => {
    renderPage();
    await settled();

    expect(selectEl("agri-district-select")).toHaveAttribute("disabled");
    fireEvent.input(selectEl("agri-state-select"), { target: { value: "Maharashtra" } });
    await waitFor(() => expect(lastParams().state).toBe("Maharashtra"));

    expect(selectEl("agri-district-select")).not.toHaveAttribute("disabled");
    expect(within(screen.getByTestId("agri-district-select")).getByRole("option", { name: "Nashik" })).toBeInTheDocument();
    fireEvent.input(selectEl("agri-district-select"), { target: { value: "Nashik" } });
    await waitFor(() => expect(lastParams().district).toBe("Nashik"));

    expect(selectEl("agri-market-select")).not.toHaveAttribute("disabled");
    fireEvent.input(selectEl("agri-market-select"), { target: { value: "Lasalgaon" } });
    await waitFor(() => expect(lastParams().market).toBe("Lasalgaon"));
  });
});

describe("AgriPage chart modes", () => {
  it("offers seven modes with no OHLC or standalone arrivals button", async () => {
    renderPage();
    await settled();

    const strip = screen.getByTestId("agri-mode-strip");
    for (const key of ["band", "compare", "distribution", "supplyDemand", "heatmap", "rolling", "seasonality"]) {
      expect(within(strip).getByTestId(`agri-mode-${key}`)).toBeInTheDocument();
    }
    expect(within(strip).queryByTestId("agri-mode-ohlc")).not.toBeInTheDocument();
    expect(within(strip).queryByTestId("agri-mode-arrivals")).not.toBeInTheDocument();
  });

  it("keeps the band option for band and routes compare through the existing builder", async () => {
    renderPage();
    await settled();
    expect(optionSeries().some((series) => series.name === "Modal")).toBe(true);

    fireEvent.click(screen.getByTestId("agri-mode-compare"));
    await waitFor(() => expect(JSON.stringify(harness.lastOption)).toContain("Wheat"));
    expect(screen.getByTestId("agri-compare-strip")).toBeInTheDocument();
    expect(screen.getByTestId("agri-compare-wheat")).toBeInTheDocument();
  });

  it.each([
    ["distribution", "boxplot"],
    ["supplyDemand", "scatter"],
    ["heatmap", "heatmap"],
  ] as const)("renders the %s EDA chart option", async (key, type) => {
    renderPage();
    await settled();

    fireEvent.click(screen.getByTestId(`agri-mode-${key}`));
    await waitFor(() => expect(optionSeries().some((series) => series.type === type)).toBe(true));
  });

  it("renders the rolling option with a trailing-mean band", async () => {
    renderPage();
    await settled();

    fireEvent.click(screen.getByTestId("agri-mode-rolling"));
    await waitFor(() =>
      expect(optionSeries().some((series) => /^Rolling mean \(\d+\)$/.test(series.name ?? ""))).toBe(true),
    );
  });

  it("renders the seasonality option", async () => {
    renderPage();
    await settled();

    fireEvent.click(screen.getByTestId("agri-mode-seasonality"));
    await waitFor(() =>
      expect(optionSeries().some((series) => series.type === "bar" && series.name === "Median")).toBe(true),
    );
  });

  it("labels chart values with ₹/quintal and arrivals in qtl", async () => {
    renderPage();
    await settled();

    expect(tooltipHtml()).toContain("₹/quintal");
    fireEvent.click(screen.getByTestId("agri-mode-supplyDemand"));
    await waitFor(() => expect(tooltipHtml()).toContain("qtl"));
    expect(tooltipHtml()).toContain("₹/quintal");
  });

  it("uses one Select for all seven modes on mobile", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width: 640px"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    renderPage();
    await settled();

    expect(screen.getByTestId("agri-mode-select")).toBeInTheDocument();
    expect(screen.queryByTestId("agri-mode-strip")).not.toBeInTheDocument();
    fireEvent.input(selectEl("agri-mode-select"), { target: { value: "heatmap" } });
    await waitFor(() => expect(optionSeries().some((series) => series.type === "heatmap")).toBe(true));
  });
});

describe("AgriPage legacy mode URLs", () => {
  it("normalises ?mode=ohlc to the band view and clears the legacy param", async () => {
    renderPage("/agri?mode=ohlc");
    await settled();

    await waitFor(() => expect(urlParams().mode).toBeUndefined());
    expect(optionSeries().some((series) => series.type === "candlestick")).toBe(false);
    expect(optionSeries().some((series) => series.name === "Modal")).toBe(true);
  });

  it("normalises ?mode=arrivals to the supplyDemand view", async () => {
    renderPage("/agri?mode=arrivals");
    await settled();

    await waitFor(() => expect(urlParams().mode).toBe("supplyDemand"));
    expect(optionSeries().some((series) => series.type === "scatter")).toBe(true);
  });
});

describe("AgriPage EDA summary", () => {
  it("summarises trend, volatility, months, correlation and outliers from the active series", async () => {
    renderPage();
    await settled();

    const summary = screen.getByTestId("agri-eda-summary");
    expect(within(summary).getByTestId("agri-eda-trend")).toHaveTextContent("+1.2%");
    expect(within(summary).getByTestId("agri-eda-volatility")).toHaveTextContent("0.6%");
    expect(within(summary).getByTestId("agri-eda-best")).toHaveTextContent("Nov");
    expect(within(summary).getByTestId("agri-eda-worst")).toHaveTextContent("Nov");
    expect(within(summary).getByTestId("agri-eda-correlation")).toHaveTextContent("1.00");
    expect(within(summary).getByTestId("agri-eda-outliers")).toHaveTextContent("0");
  });

  it("renders — when the summary inputs cannot be computed", async () => {
    vi.mocked(fetchAgriPrices).mockResolvedValueOnce(pricesPayload({ series: [] }));
    renderPage();
    await settled();

    const summary = screen.getByTestId("agri-eda-summary");
    for (const key of ["trend", "volatility", "best", "worst", "correlation", "outliers"]) {
      expect(within(summary).getByTestId(`agri-eda-${key}`)).toHaveTextContent("—");
    }
  });
});

describe("AgriPage table", () => {
  it("declares explicit alignment metadata per column", () => {
    const columns = agriColumns("2026-11-17");
    const byId = new Map(columns.map((column) => [column.id, column.meta?.align]));
    expect(byId.get("commodity")).toBe("left");
    expect(byId.get("state")).toBe("left");
    expect(byId.get("district")).toBe("left");
    expect(byId.get("market")).toBe("left");
    expect(byId.get("variety")).toBe("left");
    expect(byId.get("date")).toBe("left");
    expect(byId.get("min")).toBe("right");
    expect(byId.get("modal")).toBe("right");
    expect(byId.get("max")).toBe("right");
    expect(byId.get("arrivals")).toBe("right");
    expect(byId.get("status")).toBe("center");
  });

  it("applies the clicked row's commodity and mandi as filters and to the URL", async () => {
    renderPage();
    await settled();

    fireEvent.click(screen.getByTestId("agri-row-2026-11-17-Lasalgaon-Onion-0"));
    await waitFor(() => expect(lastParams().market).toBe("Lasalgaon"));

    expect(lastParams()).toMatchObject({
      commodity: "onion",
      state: "Maharashtra",
      district: "Nashik",
      market: "Lasalgaon",
    });
    await waitFor(() => expect(urlParams().state).toBe("Maharashtra"));
    expect(urlParams().market).toBe("Lasalgaon");
  });
});

describe("AgriPage data states", () => {
  it("explains an empty chart as of the data date but keeps the snapshot table", async () => {
    vi.mocked(fetchAgriPrices).mockResolvedValueOnce(
      pricesPayload({
        series: [],
        quotes: [],
        snapshot: [
          {
            key: "onion",
            label: "Onion",
            group: "vegetables",
            date: "2026-11-17",
            modal: 2100,
            min: 1900,
            max: 2300,
            markets: 12,
            chg_1w_pct: null,
            chg_1m_pct: null,
            chg_6m_pct: null,
          },
        ],
      }),
    );
    renderPage();
    await settled();

    expect(screen.getByTestId("agri-chart-empty")).toHaveTextContent("17 Nov 2026");
    expect(screen.queryByTestId("agri-chart")).not.toBeInTheDocument();
    expect(screen.getByTestId("agri-row-snapshot-onion")).toBeInTheDocument();
  });

  it("keeps the newest request when an older fetch resolves late", async () => {
    let resolveFirst!: (value: AgriPricesResponse) => void;
    let resolveSecond!: (value: AgriPricesResponse) => void;
    vi.mocked(fetchAgriPrices)
      .mockImplementationOnce(() => new Promise<AgriPricesResponse>((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<AgriPricesResponse>((resolve) => { resolveSecond = resolve; }));

    renderPage();
    await waitFor(() => expect(fetchAgriPrices).toHaveBeenCalledTimes(1));
    fireEvent.input(selectEl("agri-commodity-select"), { target: { value: "wheat" } });
    await waitFor(() => expect(fetchAgriPrices).toHaveBeenCalledTimes(2));

    resolveSecond(pricesPayload({ kpis: { ...pricesPayload().kpis, modal: 9999 } }));
    resolveFirst(pricesPayload());
    await waitFor(() => expect(screen.getByTestId("agri-kpi-modal")).toHaveTextContent("₹9,999"));
  });

  it("shows an error with Retry and recovers on the next attempt", async () => {
    vi.mocked(fetchAgriPrices).mockRejectedValueOnce(new Error("upstream unavailable"));
    renderPage();
    await waitFor(() => expect(screen.getByTestId("agri-error")).toHaveTextContent("upstream unavailable"));

    fireEvent.click(screen.getByTestId("agri-error-retry"));
    await waitFor(() => expect(screen.queryByTestId("agri-error")).not.toBeInTheDocument());
    expect(screen.getByTestId("agri-quotes-table")).toBeInTheDocument();
  });

  it.each([
    [1, "success"],
    [3, "warning"],
    [9, "error"],
  ])("colours the freshness banner for %i days stale", async (days, tone) => {
    vi.mocked(fetchAgriPrices).mockResolvedValueOnce(pricesPayload({ freshness_days: days }));
    renderPage();
    await settled();
    expect(screen.getByTestId("agri-freshness")).toHaveAttribute("data-tone", tone);
  });

  it("names a non-db data source", async () => {
    vi.mocked(fetchAgriPrices).mockResolvedValueOnce(pricesPayload({ data_source: "csv_seed" }));
    renderPage();
    await settled();
    expect(screen.getByTestId("agri-data-source")).toHaveTextContent("csv_seed");
  });

  it("shows the data-as-of and freshness context inline with Refresh", async () => {
    renderPage();
    await settled();

    const context = screen.getByTestId("agri-context");
    expect(within(context).getByTestId("agri-freshness")).toHaveTextContent("Data as of");
    expect(within(context).getByTestId("agri-freshness")).toHaveTextContent("17 Nov 2026");
    expect(within(context).getByTestId("agri-refresh")).toBeInTheDocument();
  });

  it("derives a compact top-movers strip from the snapshot's 1m change", async () => {
    vi.mocked(fetchAgriPrices).mockResolvedValueOnce(
      pricesPayload({
        snapshot: [
          { key: "onion", label: "Onion", group: "vegetables", date: "2026-11-17", modal: 2100, min: 1900, max: 2300, markets: 12, chg_1w_pct: 1, chg_1m_pct: 4.2, chg_6m_pct: 8 },
          { key: "wheat", label: "Wheat", group: "cereals", date: "2026-11-17", modal: 2400, min: 2200, max: 2600, markets: 20, chg_1w_pct: -1, chg_1m_pct: 2.1, chg_6m_pct: -3 },
          { key: "tomato", label: "Tomato", group: "vegetables", date: "2026-11-17", modal: 1800, min: 1600, max: 2000, markets: 9, chg_1w_pct: -2, chg_1m_pct: -5.6, chg_6m_pct: -7 },
          { key: "rice", label: "Rice", group: "cereals", date: "2026-11-17", modal: 2200, min: 2000, max: 2400, markets: 15, chg_1w_pct: -1, chg_1m_pct: -3.3, chg_6m_pct: 2 },
        ],
      }),
    );
    renderPage();
    await settled();

    const movers = screen.getByTestId("agri-movers");
    expect(movers).toHaveTextContent("Onion +4.2%");
    expect(movers).toHaveTextContent("Wheat +2.1%");
    expect(movers).toHaveTextContent("Tomato -5.6%");
    expect(movers).toHaveTextContent("Rice -3.3%");
  });

  it("omits the top-movers strip when the snapshot has no usable 1m changes", async () => {
    renderPage();
    await settled();
    expect(screen.queryByTestId("agri-movers")).not.toBeInTheDocument();
  });
});
