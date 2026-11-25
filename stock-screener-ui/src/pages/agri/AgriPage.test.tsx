// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createMemoryHistory, MemoryRouter, Route, useSearchParams } from "@solidjs/router";
import type { AgriFiltersResponse, AgriPricesResponse } from "@/types/agri";
import { fetchAgriFilters, fetchAgriPrices } from "@/api/agri";
import { AGRI_COMMODITIES, AGRI_GROUPS, agriCommodity } from "@/config/agri";
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
    { key: "maize", label: "Maize", group: "cereals", unit: "INR/quintal" },
    { key: "onion", label: "Onion", group: "vegetables", unit: "INR/quintal" },
    { key: "potato", label: "Potato", group: "vegetables", unit: "INR/quintal" },
    { key: "tomato", label: "Tomato", group: "vegetables", unit: "INR/quintal" },
    { key: "chilli", label: "Chilli", group: "spices", unit: "INR/quintal" },
  ],
  groups: [
    { key: "cereals", label: "Cereals" },
    { key: "vegetables", label: "Vegetables" },
    { key: "spices", label: "Spices" },
  ],
  // Flat lists stay intentionally broad; the state/district maps must win.
  states: ["Maharashtra", "Karnataka", "Delhi"] as unknown as AgriFiltersResponse["states"],
  districts: [
    "Nashik",
    "Pune",
    "Kolar",
    "New Delhi",
  ] as unknown as AgriFiltersResponse["districts"],
  markets: [
    "Lasalgaon",
    "Nashik",
    "Pune",
    "Kolar",
    "New Delhi",
  ] as unknown as AgriFiltersResponse["markets"],
  state_districts: {
    Maharashtra: ["Nashik", "Pune"],
    Karnataka: ["Kolar"],
    Delhi: ["New Delhi"],
  },
  district_markets: {
    "Maharashtra||Nashik": ["Lasalgaon", "Nashik"],
    "Maharashtra||Pune": ["Pune"],
    "Karnataka||Kolar": ["Kolar"],
    "Delhi||New Delhi": ["New Delhi"],
  },
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
      {
        date: "2026-11-10",
        modal: 2124,
        min: 1900,
        max: 2300,
        arrivals_qtl: 900,
        market_count: 40,
      },
      {
        date: "2026-11-17",
        modal: 2150,
        min: 1980,
        max: 2310,
        arrivals_qtl: 1200,
        market_count: 42,
      },
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
    quotes_total: 118,
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
  JSON.parse(screen.getByTestId("url-probe").getAttribute("data-url") ?? "{}") as Record<
    string,
    string
  >;

const lastParams = () => {
  const calls = vi.mocked(fetchAgriPrices).mock.calls;
  return calls[calls.length - 1]?.[0] as Record<string, unknown>;
};

async function settled() {
  await waitFor(() => expect(fetchAgriPrices).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByTestId("agri-loading")).not.toBeInTheDocument());
}

const optionSeries = () =>
  (harness.lastOption?.series ?? []) as Array<{ type?: string; name?: string }>;
const tooltipHtml = () => {
  const formatter = (
    harness.lastOption?.tooltip as { formatter?: (params: unknown) => string } | undefined
  )?.formatter;
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

describe("agri registry parity", () => {
  it("mirrors the backend's 22 commodities, labels and groups", () => {
    expect(AGRI_COMMODITIES).toHaveLength(22);
    expect(AGRI_GROUPS.map((group) => group.key)).toEqual([
      "cereals",
      "pulses",
      "vegetables",
      "oilseeds",
      "spices",
    ]);
    const keys = AGRI_COMMODITIES.map((item) => item.key);
    for (const key of [
      "paddy",
      "maize",
      "bajra",
      "jowar",
      "groundnut",
      "mustard",
      "sunflower",
      "jeera",
    ]) {
      expect(keys).toContain(key);
    }
    expect(agriCommodity("chilli")?.label).toBe("Chilli");
    expect(agriCommodity("arhar_tur")?.label).toBe("Arhar (Tur)");
    expect(agriCommodity("chana")?.label).toBe("Chana / Gram");
    expect(agriCommodity("jeera")?.group).toBe("spices");
    expect(agriCommodity("groundnut")?.group).toBe("oilseeds");
  });
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
    expect(screen.getByTestId("agri-kpi-head")).toHaveTextContent(
      "Prices ₹/quintal · arrivals qtl",
    );
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
    renderPage(
      "/agri?commodity=wheat&group=cereals&state=Karnataka&district=Kolar&market=Kolar&range=1m&mode=distribution",
    );
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

  it("cascades state → district → market from the geography maps", async () => {
    renderPage();
    await settled();

    expect(selectEl("agri-district-select")).toHaveAttribute("disabled");
    expect(
      within(screen.getByTestId("agri-district-select")).queryAllByRole("option"),
    ).toHaveLength(1);

    fireEvent.input(selectEl("agri-state-select"), { target: { value: "Maharashtra" } });
    await waitFor(() => expect(lastParams().state).toBe("Maharashtra"));

    expect(selectEl("agri-district-select")).not.toHaveAttribute("disabled");
    const districts = within(screen.getByTestId("agri-district-select"));
    expect(districts.getByRole("option", { name: "Nashik" })).toBeInTheDocument();
    expect(districts.getByRole("option", { name: "Pune" })).toBeInTheDocument();
    expect(districts.queryByRole("option", { name: "Kolar" })).not.toBeInTheDocument();
    expect(districts.queryByRole("option", { name: "New Delhi" })).not.toBeInTheDocument();

    fireEvent.input(selectEl("agri-district-select"), { target: { value: "Nashik" } });
    await waitFor(() => expect(lastParams().district).toBe("Nashik"));

    expect(selectEl("agri-market-select")).not.toHaveAttribute("disabled");
    const markets = within(screen.getByTestId("agri-market-select"));
    expect(markets.getByRole("option", { name: "Lasalgaon" })).toBeInTheDocument();
    expect(markets.getByRole("option", { name: "Nashik" })).toBeInTheDocument();
    expect(markets.queryByRole("option", { name: "Kolar" })).not.toBeInTheDocument();

    fireEvent.input(selectEl("agri-market-select"), { target: { value: "Lasalgaon" } });
    await waitFor(() => expect(lastParams().market).toBe("Lasalgaon"));
  });

  it("clears district and market when the state changes", async () => {
    renderPage("/agri?state=Maharashtra&district=Nashik&market=Lasalgaon");
    await settled();

    fireEvent.input(selectEl("agri-state-select"), { target: { value: "Karnataka" } });
    await waitFor(() => expect(lastParams().state).toBe("Karnataka"));
    expect(lastParams().district).toBeUndefined();
    expect(lastParams().market).toBeUndefined();

    const districts = within(screen.getByTestId("agri-district-select"));
    expect(districts.getByRole("option", { name: "Kolar" })).toBeInTheDocument();
    expect(districts.queryByRole("option", { name: "Nashik" })).not.toBeInTheDocument();
  });
});

describe("AgriPage chart modes", () => {
  it("offers seven modes with no OHLC or standalone arrivals button", async () => {
    renderPage();
    await settled();

    const strip = screen.getByTestId("agri-mode-strip");
    for (const key of [
      "band",
      "compare",
      "distribution",
      "supplyDemand",
      "heatmap",
      "rolling",
      "seasonality",
    ]) {
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
    expect(screen.getByTestId("agri-compare-active")).toHaveTextContent("Onion");
    expect(screen.getByTestId("agri-compare-wheat")).toBeInTheDocument();
    await waitFor(() => expect(lastParams().compare).toEqual(["onion", "wheat", "tomato"]));
  });

  it("always compares the active commodity and caps the selection at five", async () => {
    renderPage();
    await settled();
    fireEvent.click(screen.getByTestId("agri-mode-compare"));
    await waitFor(() => expect(lastParams().compare).toEqual(["onion", "wheat", "tomato"]));

    fireEvent.input(selectEl("agri-commodity-select"), { target: { value: "wheat" } });
    await waitFor(() => expect((lastParams().compare as string[])[0]).toBe("wheat"));
    expect(lastParams().compare).toEqual(["wheat", "tomato"]);

    fireEvent.input(selectEl("agri-compare-add"), { target: { value: "rice" } });
    await waitFor(() => expect(lastParams().compare).toEqual(["wheat", "tomato", "rice"]));

    fireEvent.input(selectEl("agri-compare-add"), { target: { value: "potato" } });
    await waitFor(() => expect(lastParams().compare).toHaveLength(4));

    fireEvent.input(selectEl("agri-compare-add"), { target: { value: "chilli" } });
    await waitFor(() => expect(lastParams().compare).toHaveLength(5));

    const keys = lastParams().compare as string[];
    expect(keys[0]).toBe("wheat");
    expect(new Set(keys).size).toBe(keys.length);
    expect(screen.queryByTestId("agri-compare-add")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agri-compare-wheat")).not.toBeInTheDocument();
    expect(screen.getByTestId("agri-compare-active")).toHaveTextContent("Wheat");
  });

  it("removes a comparison without dropping the active commodity", async () => {
    renderPage();
    await settled();
    fireEvent.click(screen.getByTestId("agri-mode-compare"));
    await waitFor(() => expect(lastParams().compare).toEqual(["onion", "wheat", "tomato"]));

    fireEvent.click(screen.getByTestId("agri-compare-wheat"));
    await waitFor(() => expect(lastParams().compare).toEqual(["onion", "tomato"]));
    expect(screen.getByTestId("agri-compare-active")).toHaveTextContent("Onion");
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
      expect(
        optionSeries().some((series) => /^Rolling mean \(\d+\)$/.test(series.name ?? "")),
      ).toBe(true),
    );
  });

  it("renders seasonality only when every month has two or more years", async () => {
    vi.mocked(fetchAgriPrices).mockResolvedValue(
      pricesPayload({
        series: [
          {
            date: "2025-01-15",
            modal: 2000,
            min: 1900,
            max: 2100,
            arrivals_qtl: null,
            market_count: 10,
          },
          {
            date: "2026-01-15",
            modal: 2100,
            min: 2000,
            max: 2200,
            arrivals_qtl: null,
            market_count: 12,
          },
        ],
      }),
    );
    renderPage();
    await settled();

    fireEvent.click(screen.getByTestId("agri-mode-seasonality"));
    await waitFor(() =>
      expect(
        optionSeries().some((series) => series.type === "bar" && series.name === "Median"),
      ).toBe(true),
    );
    expect(screen.queryByTestId("agri-seasonality-weak")).not.toBeInTheDocument();
  });

  it("shows a disabled weak-history state instead of pretending one year is a cycle", async () => {
    renderPage();
    await settled();

    fireEvent.click(screen.getByTestId("agri-mode-seasonality"));
    await waitFor(() => expect(screen.getByTestId("agri-seasonality-weak")).toBeInTheDocument());
    expect(screen.getByTestId("agri-seasonality-weak")).toHaveTextContent(
      "at least two distinct years",
    );
    expect(screen.getByTestId("agri-seasonality-weak")).toHaveTextContent("need 2+");
    expect(screen.queryByTestId("agri-chart")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("agri-seasonality-band"));
    await waitFor(() =>
      expect(optionSeries().some((series) => series.name === "Modal")).toBe(true),
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
    await waitFor(() =>
      expect(optionSeries().some((series) => series.type === "heatmap")).toBe(true),
    );
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

  it("shows the API page size against the total and a default modal sort", async () => {
    renderPage();
    await settled();

    const panel = screen.getByTestId("agri-table-panel");
    expect(panel).toHaveTextContent("showing 2 of 118 quotes");
    expect(panel).toHaveTextContent("not the full mandi universe");
    expect(screen.getByTestId("agri-table-scope")).toHaveTextContent("Sorted by modal price");

    const modalHeader = screen.getByRole("columnheader", { name: /Modal/ });
    expect(modalHeader).toHaveAttribute("aria-sort", "descending");
    const rows = screen.getAllByTestId(/^agri-row-/);
    expect(rows[0]).toHaveAttribute("data-testid", "agri-row-2026-11-17-Kolar-Onion-1");
  });

  it("falls back to the shown count when the payload has no quote total", async () => {
    const payload = pricesPayload();
    delete payload.quotes_total;
    vi.mocked(fetchAgriPrices).mockResolvedValueOnce(payload);
    renderPage();
    await settled();

    expect(screen.getByTestId("agri-table-panel")).toHaveTextContent("2 quotes shown");
    expect(screen.getByTestId("agri-table-panel")).toHaveTextContent("not the full mandi universe");
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

  it("keeps the working body visible during a refresh", async () => {
    let resolveRefresh!: (value: AgriPricesResponse) => void;
    renderPage();
    await settled();
    expect(screen.getByTestId("agri-quotes-table")).toBeInTheDocument();

    vi.mocked(fetchAgriPrices).mockImplementationOnce(
      () =>
        new Promise<AgriPricesResponse>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    fireEvent.click(screen.getByTestId("agri-refresh"));

    await waitFor(() => expect(screen.getByTestId("agri-refreshing")).toBeInTheDocument());
    expect(screen.queryByTestId("agri-loading")).not.toBeInTheDocument();
    expect(screen.getByTestId("agri-body")).toBeInTheDocument();
    expect(screen.getByTestId("agri-quotes-table")).toBeInTheDocument();
    expect(screen.getByTestId("agri-body")).toHaveAttribute("aria-busy", "true");

    resolveRefresh(pricesPayload({ kpis: { ...pricesPayload().kpis, modal: 2222 } }));
    await waitFor(() => expect(screen.queryByTestId("agri-refreshing")).not.toBeInTheDocument());
    expect(screen.getByTestId("agri-kpi-modal")).toHaveTextContent("₹2,222");
    expect(screen.getByTestId("agri-quotes-table")).toBeInTheDocument();
  });

  it("renders gap and coverage warnings instead of hiding them in a truncated line", async () => {
    vi.mocked(fetchAgriPrices).mockResolvedValueOnce(
      pricesPayload({
        warnings: [
          "data has a 174-day gap (2026-06-01 → 2026-11-20); short-window changes and rolling metrics skip it",
          "arrivals coverage is unavailable for this source",
          "MSP not verified for Onion; distance_to_msp_pct is null",
        ],
      }),
    );
    renderPage();
    await settled();

    const warnings = screen.getByTestId("agri-warnings");
    expect(warnings).toHaveTextContent("174-day gap");
    expect(within(warnings).getByTestId("agri-gap-warning")).toBeInTheDocument();
    expect(within(warnings).getByTestId("agri-coverage-warning")).toHaveTextContent(
      "arrivals coverage",
    );
    expect(warnings).toHaveTextContent("MSP not verified");
  });

  it("keeps the newest request when an older fetch resolves late", async () => {
    let resolveFirst!: (value: AgriPricesResponse) => void;
    let resolveSecond!: (value: AgriPricesResponse) => void;
    vi.mocked(fetchAgriPrices)
      .mockImplementationOnce(
        () =>
          new Promise<AgriPricesResponse>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<AgriPricesResponse>((resolve) => {
            resolveSecond = resolve;
          }),
      );

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
    await waitFor(() =>
      expect(screen.getByTestId("agri-error")).toHaveTextContent("upstream unavailable"),
    );

    fireEvent.click(screen.getByTestId("agri-error-retry"));
    await waitFor(() => expect(screen.queryByTestId("agri-error")).not.toBeInTheDocument());
    expect(screen.getByTestId("agri-quotes-table")).toBeInTheDocument();
  });

  it("aborts the previous filters request when Retry starts a new one", async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(fetchAgriFilters)
      .mockImplementationOnce((signal) => {
        signals.push(signal as AbortSignal);
        return Promise.reject(new Error("filters down"));
      })
      .mockImplementationOnce((signal) => {
        signals.push(signal as AbortSignal);
        return Promise.resolve(filtersPayload);
      });

    renderPage();
    await waitFor(() => expect(screen.getByTestId("agri-filters-error")).toBeInTheDocument());
    expect(signals).toHaveLength(1);

    fireEvent.click(screen.getByTestId("agri-filters-error-retry"));
    await settled();

    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
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
          {
            key: "onion",
            label: "Onion",
            group: "vegetables",
            date: "2026-11-17",
            modal: 2100,
            min: 1900,
            max: 2300,
            markets: 12,
            chg_1w_pct: 1,
            chg_1m_pct: 4.2,
            chg_6m_pct: 8,
          },
          {
            key: "wheat",
            label: "Wheat",
            group: "cereals",
            date: "2026-11-17",
            modal: 2400,
            min: 2200,
            max: 2600,
            markets: 20,
            chg_1w_pct: -1,
            chg_1m_pct: 2.1,
            chg_6m_pct: -3,
          },
          {
            key: "tomato",
            label: "Tomato",
            group: "vegetables",
            date: "2026-11-17",
            modal: 1800,
            min: 1600,
            max: 2000,
            markets: 9,
            chg_1w_pct: -2,
            chg_1m_pct: -5.6,
            chg_6m_pct: -7,
          },
          {
            key: "rice",
            label: "Rice",
            group: "cereals",
            date: "2026-11-17",
            modal: 2200,
            min: 2000,
            max: 2400,
            markets: 15,
            chg_1w_pct: -1,
            chg_1m_pct: -3.3,
            chg_6m_pct: 2,
          },
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

describe("AgriPage accessibility", () => {
  it("gives the cascade selects accessible names when their labels are hidden", async () => {
    renderPage();
    await settled();

    for (const [testId, label] of [
      ["agri-group-select", "Commodity group"],
      ["agri-commodity-select", "Commodity"],
      ["agri-state-select", "State"],
      ["agri-district-select", "District"],
      ["agri-market-select", "Mandi"],
    ] as const) {
      expect(selectEl(testId), testId).toHaveAttribute("aria-label", label);
    }
  });

  it("exposes pressed state on the range, mode and view segment switches", async () => {
    renderPage();
    await settled();

    expect(screen.getByTestId("agri-range-6m")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("agri-range-1m")).toHaveAttribute("aria-pressed", "false");

    const modeStrip = screen.getByTestId("agri-mode-strip");
    expect(within(modeStrip).getByTestId("agri-mode-band")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(modeStrip).getByTestId("agri-mode-heatmap"));
    await waitFor(() =>
      expect(within(modeStrip).getByTestId("agri-mode-heatmap")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(within(modeStrip).getByTestId("agri-mode-band")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    expect(screen.getByTestId("agri-view-chart")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("agri-view-groups"));
    await waitFor(() =>
      expect(screen.getByTestId("agri-view-groups")).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("names the mobile mode select and the compare picker", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width: 640px"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    renderPage();
    await settled();

    expect(selectEl("agri-mode-select")).toHaveAttribute("aria-label", "Chart view");

    fireEvent.input(selectEl("agri-mode-select"), { target: { value: "compare" } });
    await waitFor(() => expect(screen.getByTestId("agri-compare-add")).toBeInTheDocument());
    expect(selectEl("agri-compare-add")).toHaveAttribute(
      "aria-label",
      "Add commodity to comparison",
    );
  });
});

describe("AgriPage layout", () => {
  it("shows the quotes table with the chart and the matrix only in Categories", async () => {
    renderPage();
    await settled();

    expect(screen.getByTestId("agri-chart-panel")).toBeInTheDocument();
    expect(screen.getByTestId("agri-table-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("agri-groups-view")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("agri-view-groups"));
    const groups = screen.getByTestId("agri-groups-view");
    expect(within(groups).getByTestId("agri-group-overview")).toBeInTheDocument();
    expect(within(groups).getByTestId("agri-fluctuation-matrix-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("agri-chart-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agri-table-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("agri-view-chart"));
    expect(screen.getByTestId("agri-chart-panel")).toBeInTheDocument();
    expect(screen.getByTestId("agri-table-panel")).toBeInTheDocument();
  });

  it("gives both stat grids 8px gaps and stretchable, padded cards", async () => {
    renderPage();
    await settled();

    expect(screen.getByTestId("agri-kpis")).toHaveClass("gap-2");
    expect(screen.getByTestId("agri-eda-summary")).toHaveClass("gap-2");
    expect(screen.getByTestId("agri-kpi-modal")).toHaveClass("h-full", "p-2");
    expect(screen.getByTestId("agri-eda-trend")).toHaveClass("h-full", "p-2");
  });

  it("keeps controls reachable and reserves a 240px plot at mobile width", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width: 640px"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    renderPage();
    await settled();

    expect(screen.getByTestId("agri-kpis")).toHaveClass("overflow-x-auto");
    expect(screen.getByTestId("agri-eda-summary")).toHaveClass("overflow-x-auto");
    expect(screen.getByTestId("agri-chart-region")).toHaveClass("min-h-[240px]");
    expect(screen.getByTestId("agri-body")).toHaveClass("overflow-y-auto");
    expect(screen.getByTestId("agri-table-scroll-hint")).toHaveTextContent("→");
    expect(screen.getByTestId("agri-page")).toHaveClass("overflow-hidden", "min-h-0");
    expect(screen.getByTestId("agri-refresh")).toBeInTheDocument();
  });
});
