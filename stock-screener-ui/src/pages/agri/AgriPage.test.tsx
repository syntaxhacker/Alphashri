// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createMemoryHistory, MemoryRouter, Route, useSearchParams } from "@solidjs/router";
import type {
  AgriFiltersResponse,
  AgriPricesResponse,
  AgriSourcesResponse,
} from "@/types/agri";
import { fetchAgriFilters, fetchAgriPrices, fetchAgriSources } from "@/api/agri";
import { AGRI_COMMODITIES, AGRI_GROUPS, agriCommodity } from "@/config/agri";
import { AGRI_SEASON_STOPS } from "@/ui/palette";
import { agriColumns } from "./agriColumns";
import { AgriPage } from "./AgriPage";

const harness = vi.hoisted(() => ({
  options: {} as Record<string, Record<string, any> | undefined>,
}));

vi.mock("@/api/agri", () => ({
  fetchAgriFilters: vi.fn(),
  fetchAgriPrices: vi.fn(),
  fetchAgriSources: vi.fn(),
}));

vi.mock("@/components/common/EChart", async () => {
  const { createEffect } = await import("solid-js");
  return {
    EChart: (props: { option: Record<string, any>; "data-testid"?: string }) => {
      createEffect(() => {
        harness.options[props["data-testid"] ?? "agri-chart"] = props.option;
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
  states: ["Maharashtra", "Karnataka", "Delhi"] as unknown as AgriFiltersResponse["states"],
  districts: ["Nashik", "Pune", "Kolar", "New Delhi"] as unknown as AgriFiltersResponse["districts"],
  markets: ["Lasalgaon", "Nashik", "Pune", "Kolar", "New Delhi"] as unknown as AgriFiltersResponse["markets"],
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

const sourcesPayload: AgriSourcesResponse = {
  default: "local",
  sources: [
    {
      id: "local",
      label: "Local cache",
      dataset: "local",
      as_of: "2026-11-21",
      rows: 2328450,
      status: "available",
    },
    {
      id: "release:data-2026-11",
      label: "Release data-2026-11",
      dataset: "data-2026-11",
      as_of: "2026-11-21",
      rows: 42,
      status: "available",
    },
  ],
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
    snapshot: [
      {
        key: "onion",
        label: "Onion",
        group: "vegetables",
        date: "2026-11-17",
        modal: 2150,
        min: 1980,
        max: 2310,
        markets: 42,
        chg_1w_pct: 1.2,
        chg_1m_pct: -3.4,
        chg_6m_pct: 8.9,
      },
      {
        key: "wheat",
        label: "Wheat",
        group: "cereals",
        date: "2026-11-17",
        modal: 2450,
        min: 2200,
        max: 2600,
        markets: 30,
        chg_1w_pct: 0.8,
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
    ],
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
          { date: "2026-10-17", modal: 2380 },
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

const lastFilterSource = () => {
  const calls = vi.mocked(fetchAgriFilters).mock.calls;
  return calls[calls.length - 1]?.[1] as string | undefined;
};

async function settled() {
  await waitFor(() => expect(fetchAgriPrices).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByTestId("agri-loading")).not.toBeInTheDocument());
}

const optionFor = (id = "agri-chart") => harness.options[id] ?? {};
const optionSeries = (id = "agri-chart") =>
  (optionFor(id).series ?? []) as Array<{ type?: string; name?: string }>;
const tooltipHtml = (id = "agri-chart") => {
  const formatter = (
    optionFor(id).tooltip as { formatter?: (params: unknown) => string } | undefined
  )?.formatter;
  return formatter ? formatter([{ dataIndex: 0 }]) : "";
};

function selectEl(testId: string): HTMLSelectElement {
  const native = screen.getByTestId(testId).querySelector("select");
  if (!native) throw new Error(`no native select inside ${testId}`);
  return native as HTMLSelectElement;
}

const selectedLabel = (testId: string): string =>
  selectEl(testId).selectedOptions[0]?.textContent?.trim() ?? "";

const openDataView = () => fireEvent.click(screen.getByTestId("agri-view-data"));

const CHART_REGION_HEIGHTS = [
  ["agri-chart-region", "280px"],
  ["agri-rank-region", "280px"],
  ["agri-season-region", "320px"],
  ["agri-dispersion-region", "300px"],
] as const;

const CHART_PANEL_HEIGHTS = [
  ["agri-chart-panel", "460px"],
  ["agri-rank-panel", "380px"],
  ["agri-season-panel", "460px"],
  ["agri-dispersion-panel", "460px"],
] as const;

/** ECharts measures its container at mount; a flex-only parent can read 0px. */
const expectChartRegionsSized = () => {
  for (const [id, height] of CHART_REGION_HEIGHTS) {
    expect(screen.getByTestId(id), id).toHaveStyle({ "min-height": height });
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  harness.options = {};
  vi.mocked(fetchAgriFilters).mockResolvedValue(filtersPayload);
  vi.mocked(fetchAgriPrices).mockResolvedValue(pricesPayload());
  vi.mocked(fetchAgriSources).mockResolvedValue(sourcesPayload);
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

describe("AgriPage initial load — visuals first", () => {
  it("loads filters first, then prices with the default commodity and 6m range", async () => {
    renderPage();
    await settled();

    expect(fetchAgriFilters).toHaveBeenCalledTimes(1);
    expect(lastParams()).toMatchObject({ commodity: "onion", range: "6m" });
    expect(screen.getByTestId("agri-freshness")).toHaveAttribute("data-tone", "warning");
    expect(screen.getByTestId("agri-scan-group")).toBeInTheDocument();
    expect(screen.getByTestId("agri-range-group")).toBeInTheDocument();
    expect(screen.getByTestId("agri-geo-group")).toBeInTheDocument();
    expect(screen.getByTestId("agri-kpi-head")).toHaveTextContent(
      "₹/quintal · change vs. prior period",
    );
  });

  it("renders hero, universe, rank, seasonality and dispersion with no table by default", async () => {
    renderPage();
    await settled();

    for (const id of [
      "agri-overview-grid",
      "agri-chart-panel",
      "agri-spark-panel",
      "agri-rank-panel",
      "agri-season-panel",
      "agri-dispersion-panel",
    ]) {
      expect(screen.getByTestId(id), id).toBeInTheDocument();
    }
    for (const id of ["agri-chart", "agri-rank-chart", "agri-season-chart", "agri-dispersion-chart"]) {
      expect(screen.getByTestId(id), id).toBeInTheDocument();
    }
    expect(screen.getByTestId("agri-chart-panel")).toHaveTextContent(
      "How to read: bold = modal ₹/quintal",
    );
    expect(screen.getByTestId("agri-page").textContent?.match(/How to read/g) ?? []).toHaveLength(2);
    expect(screen.getByTestId("agri-chart-panel")).toHaveTextContent("How to read:");
    expect(screen.getByTestId("agri-season-panel")).toHaveTextContent("How to read:");
    expect(screen.queryByTestId("agri-quotes-table")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agri-table-panel")).not.toBeInTheDocument();
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

describe("AgriPage source selection", () => {
  it("defaults to local with no source in the URL or API requests", async () => {
    renderPage();
    await settled();

    expect(selectEl("agri-source-select")).toHaveValue("local");
    expect(screen.queryByTestId("agri-source-badge")).not.toBeInTheDocument();
    expect(urlParams().source).toBeUndefined();
    expect(lastParams().source).toBeUndefined();
    expect(lastFilterSource()).toBeUndefined();
    expect(
      within(screen.getByTestId("agri-source-select")).getByRole("option", {
        name: "Release data-2026-11",
      }),
    ).toBeInTheDocument();
  });

  it("lists discovered sources and hydrates a release from the URL", async () => {
    renderPage("/agri?source=release:data-2026-11");
    await settled();

    expect(selectEl("agri-source-select")).toHaveValue("release:data-2026-11");
    expect(screen.getByTestId("agri-source-badge")).toHaveTextContent("Release data-2026-11");
    expect(lastParams().source).toBe("release:data-2026-11");
    expect(lastFilterSource()).toBe("release:data-2026-11");
    expect(urlParams().source).toBe("release:data-2026-11");
  });

  it("shows the complete release label in a wide closed control at desktop width", async () => {
    renderPage("/agri?source=release:data-2026-11");
    await settled();

    expect(selectedLabel("agri-source-select")).toBe("Release data-2026-11");
    expect(selectedLabel("agri-source-select")).not.toMatch(/…|\.\.\./);
    expect(screen.getByTestId("agri-source-select").parentElement).toHaveClass("w-[200px]");
  });

  it("shows the complete compact dataset tag when the control is narrow", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width: 640px"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    renderPage("/agri?source=release:data-2026-11");
    await settled();

    expect(selectedLabel("agri-source-select")).toBe("data-2026-11");
    expect(selectedLabel("agri-source-select")).not.toMatch(/…|\.\.\./);
    expect(selectEl("agri-source-select")).toHaveValue("release:data-2026-11");
    expect(screen.getByTestId("agri-source-select").parentElement).toHaveClass("max-sm:w-[132px]");
  });

  it("reloads filters and prices and writes the URL when a release is selected", async () => {
    renderPage();
    await settled();
    const filterCalls = vi.mocked(fetchAgriFilters).mock.calls.length;
    const priceCalls = vi.mocked(fetchAgriPrices).mock.calls.length;

    fireEvent.input(selectEl("agri-source-select"), {
      target: { value: "release:data-2026-11" },
    });

    await waitFor(() => expect(lastParams().source).toBe("release:data-2026-11"));
    await waitFor(() => expect(lastFilterSource()).toBe("release:data-2026-11"));
    await waitFor(() => expect(urlParams().source).toBe("release:data-2026-11"));
    expect(vi.mocked(fetchAgriFilters).mock.calls.length).toBeGreaterThan(filterCalls);
    expect(vi.mocked(fetchAgriPrices).mock.calls.length).toBeGreaterThan(priceCalls);
  });

  it("drops the source from the URL and both requests when returning to local", async () => {
    renderPage("/agri?source=release:data-2026-11");
    await settled();

    fireEvent.input(selectEl("agri-source-select"), { target: { value: "local" } });

    await waitFor(() => expect(urlParams().source).toBeUndefined());
    await waitFor(() => expect(lastParams().source).toBeUndefined());
    await waitFor(() => expect(lastFilterSource()).toBeUndefined());
    expect(screen.queryByTestId("agri-source-badge")).not.toBeInTheDocument();
  });

  it("falls back to local when /sources fails", async () => {
    vi.mocked(fetchAgriSources).mockRejectedValueOnce(new Error("sources down"));
    renderPage("/agri?source=release:data-2026-11");
    await settled();

    await waitFor(() => expect(selectEl("agri-source-select")).toHaveValue("local"));
    await waitFor(() => expect(urlParams().source).toBeUndefined());
    expect(lastParams().source).toBeUndefined();
    expect(
      within(screen.getByTestId("agri-source-select")).queryByRole("option", {
        name: "Release data-2026-11",
      }),
    ).not.toBeInTheDocument();
  });

  it("falls back to local for a source this deployment does not advertise", async () => {
    renderPage("/agri?source=release:data-2099-01");
    await settled();

    await waitFor(() => expect(selectEl("agri-source-select")).toHaveValue("local"));
    await waitFor(() => expect(urlParams().source).toBeUndefined());
    expect(lastParams().source).toBeUndefined();
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
    // The spark universe follows the same group scope as the commodity select.
    expect(screen.getByTestId("agri-spark-wheat")).toBeInTheDocument();
    expect(screen.queryByTestId("agri-spark-onion")).not.toBeInTheDocument();
    expect(screen.getByTestId("agri-spark-panel")).toHaveTextContent("change = 1M");
  });

  it("refetches with the chosen range", async () => {
    renderPage();
    await settled();

    fireEvent.click(screen.getByTestId("agri-range-1m"));
    await waitFor(() => expect(lastParams().range).toBe("1m"));
  });

  it("clears the range parameter when returning to the default window", async () => {
    renderPage("/agri?range=max");
    await settled();
    expect(lastParams().range).toBe("max");

    fireEvent.click(screen.getByTestId("agri-range-6m"));
    await waitFor(() => expect(lastParams().range).toBe("6m"));
    await waitFor(() => expect(urlParams().range).toBeUndefined());
  });

  it("cascades state → district → market from the geography maps", async () => {
    renderPage();
    await settled();

    expect(selectEl("agri-district-select")).toHaveAttribute("disabled");
    fireEvent.input(selectEl("agri-state-select"), { target: { value: "Maharashtra" } });
    await waitFor(() => expect(lastParams().state).toBe("Maharashtra"));
    expect(selectEl("agri-district-select")).not.toHaveAttribute("disabled");
    const districts = within(screen.getByTestId("agri-district-select"));
    expect(districts.getByRole("option", { name: "Nashik" })).toBeInTheDocument();
    expect(districts.queryByRole("option", { name: "Kolar" })).not.toBeInTheDocument();

    fireEvent.input(selectEl("agri-district-select"), { target: { value: "Nashik" } });
    await waitFor(() => expect(lastParams().district).toBe("Nashik"));
    const markets = within(screen.getByTestId("agri-market-select"));
    expect(markets.getByRole("option", { name: "Lasalgaon" })).toBeInTheDocument();
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
    // The hero draws modal + tracked lines, so the tab must not promise a band.
    expect(within(strip).getByTestId("agri-mode-band")).toHaveTextContent("Price");
    expect(within(strip).getByTestId("agri-mode-band")).not.toHaveTextContent("band");
  });

  it("keeps the band option for band and routes compare through the existing builder", async () => {
    renderPage();
    await settled();
    expect(optionFor().title).toBeUndefined();
    expect(
      (optionFor().series as Array<{ endLabel?: { show?: boolean } }>)[0].endLabel?.show,
    ).toBe(true);

    fireEvent.click(screen.getByTestId("agri-mode-compare"));
    await waitFor(() => expect(JSON.stringify(optionFor())).toContain("Wheat"));
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
    expect(screen.getByTestId("agri-compare-active")).toHaveTextContent("Wheat");
  });

  it("removes a comparison without dropping the active commodity", async () => {
    renderPage();
    await settled();
    fireEvent.click(screen.getByTestId("agri-mode-compare"));
    await waitFor(() => expect(lastParams().compare).toEqual(["onion", "wheat", "tomato"]));

    fireEvent.click(screen.getByTestId("agri-compare-wheat"));
    await waitFor(() => expect(lastParams().compare).toEqual(["onion", "tomato"]));
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
    expect(screen.queryByTestId("agri-chart")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("agri-seasonality-band"));
    await waitFor(() =>
      expect((optionFor().series as Array<{ endLabel?: { show?: boolean } }>)[0].endLabel?.show).toBe(true),
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
    expect((optionFor().series as Array<{ endLabel?: { show?: boolean } }>)[0].endLabel?.show).toBe(true);
  });

  it("normalises ?mode=arrivals to the supplyDemand view", async () => {
    renderPage("/agri?mode=arrivals");
    await settled();

    await waitFor(() => expect(urlParams().mode).toBe("supplyDemand"));
    expect(optionSeries().some((series) => series.type === "scatter")).toBe(true);
  });
});

describe("AgriPage KPI and EDA consolidation", () => {
  it("removes the six-card EDA summary and folds trend / volatility into the hero caption", async () => {
    renderPage();
    await settled();

    expect(screen.queryByTestId("agri-eda-summary")).not.toBeInTheDocument();
    for (const key of ["trend", "volatility", "best", "worst", "correlation", "outliers"]) {
      expect(screen.queryByTestId(`agri-eda-${key}`)).not.toBeInTheDocument();
    }
    const hero = screen.getByTestId("agri-chart-panel");
    expect(hero).toHaveTextContent("+1.2% window");
    expect(hero).toHaveTextContent("modal CV 0.6%");
    expect(hero).toHaveTextContent("n=2 sessions");
    expect(hero).toHaveTextContent("How to read: bold = modal ₹/quintal");
  });

  it("keeps the EDA wall removed when the series is empty", async () => {
    vi.mocked(fetchAgriPrices).mockResolvedValueOnce(pricesPayload({ series: [] }));
    renderPage();
    await settled();

    expect(screen.queryByTestId("agri-eda-summary")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agri-eda-trend")).not.toBeInTheDocument();
    expect(screen.getByTestId("agri-chart-empty")).toBeInTheDocument();
  });
});

describe("AgriPage Data view", () => {
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
    openDataView();

    const panel = screen.getByTestId("agri-table-panel");
    expect(panel).toHaveTextContent("showing 2 of 118 quotes");
    expect(panel).toHaveTextContent("not the full mandi universe");
    expect(screen.getByTestId("agri-table-scope")).toHaveTextContent("Sorted by modal price");

    const modalHeader = screen.getByRole("columnheader", { name: /Modal/ });
    expect(modalHeader).toHaveAttribute("aria-sort", "descending");
    expect(screen.getAllByTestId(/^agri-row-/)[0]).toHaveAttribute(
      "data-testid",
      "agri-row-2026-11-17-Kolar-Onion-1",
    );
  });

  it("falls back to the shown count when the payload has no quote total", async () => {
    const payload = pricesPayload();
    delete payload.quotes_total;
    vi.mocked(fetchAgriPrices).mockResolvedValueOnce(payload);
    renderPage();
    await settled();
    openDataView();

    expect(screen.getByTestId("agri-table-panel")).toHaveTextContent("2 quotes shown");
  });

  it("applies the clicked row's commodity and mandi as filters and returns to Overview", async () => {
    renderPage();
    await settled();
    openDataView();

    fireEvent.click(screen.getByTestId("agri-row-2026-11-17-Lasalgaon-Onion-0"));
    await waitFor(() => expect(lastParams().market).toBe("Lasalgaon"));

    expect(lastParams()).toMatchObject({
      commodity: "onion",
      state: "Maharashtra",
      district: "Nashik",
      market: "Lasalgaon",
    });
    await waitFor(() => expect(screen.getByTestId("agri-overview-grid")).toBeInTheDocument());
  });
});

describe("AgriPage data states", () => {
  it("explains an empty chart as of the data date but keeps the other panels", async () => {
    vi.mocked(fetchAgriPrices).mockResolvedValueOnce(
      pricesPayload({
        series: [],
        quotes: [],
        comparison: [],
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
    expect(screen.getByTestId("agri-spark-onion")).toBeInTheDocument();
    // The empty panel must not reserve a 460px blank chart body.
    expect(screen.getByTestId("agri-chart-panel")).toHaveStyle({ "min-height": "0px" });
    expect(screen.getByTestId("agri-chart-panel")).toHaveStyle({ "align-self": "start" });
  });

  it("collapses an empty commodity universe instead of reserving 620px", async () => {
    vi.mocked(fetchAgriPrices).mockResolvedValueOnce(
      pricesPayload({ series: [], snapshot: [], comparison: [], quotes: [], quotes_total: 0 }),
    );
    renderPage();
    await settled();

    expect(screen.getByTestId("agri-spark-empty")).toBeInTheDocument();
    expect(screen.getByTestId("agri-spark-panel")).toHaveStyle({ "min-height": "0px" });
    expect(screen.getByTestId("agri-spark-panel")).toHaveStyle({ "align-self": "start" });
  });

  it("keeps the working body visible during a refresh", async () => {
    let resolveRefresh!: (value: AgriPricesResponse) => void;
    renderPage();
    await settled();
    expect(screen.getByTestId("agri-chart")).toBeInTheDocument();

    vi.mocked(fetchAgriPrices).mockImplementationOnce(
      () =>
        new Promise<AgriPricesResponse>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    fireEvent.click(screen.getByTestId("agri-refresh"));

    await waitFor(() => expect(screen.getByTestId("agri-refreshing")).toBeInTheDocument());
    expect(screen.queryByTestId("agri-loading")).not.toBeInTheDocument();
    expect(screen.getByTestId("agri-body")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("agri-chart")).toBeInTheDocument();

    resolveRefresh(pricesPayload({ kpis: { ...pricesPayload().kpis, modal: 2222 } }));
    await waitFor(() => expect(screen.queryByTestId("agri-refreshing")).not.toBeInTheDocument());
    expect(screen.getByTestId("agri-kpi-modal")).toHaveTextContent("₹2,222");
  });

  it("renders gap and coverage warnings instead of hiding them", async () => {
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
    expect(screen.getByTestId("agri-chart")).toBeInTheDocument();
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
    fireEvent.click(screen.getByTestId("agri-filters-error-retry"));
    await settled();

    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    expect(screen.getByTestId("agri-chart")).toBeInTheDocument();
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

  it("explains a mixed-source payload instead of leaving a bare MIXED badge", async () => {
    vi.mocked(fetchAgriPrices).mockResolvedValueOnce(pricesPayload({ data_source: "mixed" }));
    renderPage();
    await settled();
    const badge = screen.getByTestId("agri-data-source");
    expect(badge).toHaveTextContent("Mixed sources");
    expect(badge).toHaveAttribute("title", expect.stringContaining("more than one feed"));
  });

  it("shows the data-as-of and freshness context inline with Refresh", async () => {
    renderPage();
    await settled();

    const context = screen.getByTestId("agri-context");
    expect(within(context).getByTestId("agri-freshness")).toHaveTextContent("Data as of");
    expect(within(context).getByTestId("agri-freshness")).toHaveTextContent("17 Nov 2026");
    expect(within(context).getByTestId("agri-refresh")).toBeInTheDocument();
  });

  it("replaces the plain-text top-movers line with one visual headline strip", async () => {
    renderPage();
    await settled();

    expect(screen.queryByTestId("agri-movers")).not.toBeInTheDocument();
    const headline = screen.getByTestId("agri-headline");
    expect(within(headline).getByTestId("agri-kpi-modal")).toHaveTextContent("₹2,150");
    expect(within(headline).getByTestId("agri-kpi-chg1w")).toHaveTextContent("▲ +1.2%");
    expect(within(headline).getByTestId("agri-kpi-chg1m")).toHaveTextContent("▼ -3.4%");
  });

  it("keeps the headline when the snapshot has no usable 1m changes", async () => {
    vi.mocked(fetchAgriPrices).mockResolvedValueOnce(
      pricesPayload({
        snapshot: [
          {
            key: "onion",
            label: "Onion",
            group: "vegetables",
            date: "2026-11-17",
            modal: 2150,
            min: 1980,
            max: 2310,
            markets: 42,
            chg_1w_pct: null,
            chg_1m_pct: null,
            chg_6m_pct: null,
          },
        ],
      }),
    );
    renderPage();
    await settled();
    expect(screen.queryByTestId("agri-movers")).not.toBeInTheDocument();
    expect(screen.getByTestId("agri-headline")).toBeInTheDocument();
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
      expect(within(modeStrip).getByTestId("agri-mode-heatmap")).toHaveAttribute("aria-pressed", "true"),
    );

    expect(screen.getByTestId("agri-view-chart")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("agri-view-groups"));
    await waitFor(() =>
      expect(screen.getByTestId("agri-view-groups")).toHaveAttribute("aria-pressed", "true"),
    );
    fireEvent.click(screen.getByTestId("agri-view-data"));
    await waitFor(() =>
      expect(screen.getByTestId("agri-view-data")).toHaveAttribute("aria-pressed", "true"),
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
  });
});

describe("AgriPage redesign grammar", () => {
  it("focuses the hero with a direct end label, as-of rule and how-to-read line", async () => {
    renderPage();
    await settled();

    const option = optionFor();
    expect(option.title).toBeUndefined();
    expect(option.legend).toBeUndefined();
    expect(screen.getByTestId("agri-chart-panel")).toHaveTextContent("How to read:");
    expect(((option.series as Array<{ endLabel?: { show?: boolean } }>)[0].endLabel)?.show).toBe(true);
    const markLine = (option.series as Array<{ markLine?: { data: Array<{ label: { formatter: string } }> } }>)[0].markLine;
    expect(markLine?.data[0].label.formatter).toContain("as of");
    // One focused series plus muted context — never ten equal lines.
    expect((option.series as unknown[]).length).toBe(2);
  });

  it("draws a monthly bump board with an inverted rank axis and direct end labels", async () => {
    renderPage();
    await settled();

    const option = optionFor("agri-rank-chart");
    expect(option.title).toBeUndefined();
    expect(option.legend).toBeUndefined();
    const axis = (option.yAxis as Array<{ inverse?: boolean }>)[0];
    expect(axis.inverse).toBe(true);
    const xAxis = (option.xAxis as Array<{ data: string[]; axisLabel: { interval: number } }>)[0];
    expect(xAxis.data.length).toBeLessThanOrEqual(24);
    const visibleTicks = Math.floor((xAxis.data.length - 1) / (xAxis.axisLabel.interval + 1)) + 1;
    expect(visibleTicks).toBeLessThanOrEqual(4);
    expect((option.series as unknown[]).length).toBeGreaterThanOrEqual(2);
    for (const series of option.series as Array<{ endLabel?: { show?: boolean } }>) {
      expect(series.endLabel?.show).toBe(true);
    }
    const panel = screen.getByTestId("agri-rank-panel");
    expect(panel).toHaveTextContent("₹/quintal");
    expect(panel).toHaveTextContent("n=2 commodities");
  });

  it("uses a diverging agri season ramp with direct labels and an n annotation", async () => {
    renderPage();
    await settled();

    const option = optionFor("agri-season-chart");
    expect(option.title).toBeUndefined();
    expect(option.legend).toBeUndefined();
    const visualMap = (option.visualMap as Array<{ inRange: { color: string[] }; splitNumber: number }>)[0];
    expect(visualMap.inRange.color).toEqual([...AGRI_SEASON_STOPS]);
    expect(visualMap.splitNumber).toBeLessThanOrEqual(3);
    const xAxis = (option.xAxis as Array<{ data: string[]; axisLabel: { width: number } }>)[0];
    expect(xAxis.data).toHaveLength(12);
    expect(xAxis.axisLabel.width).toBeLessThanOrEqual(28);
    expect(((option.series as Array<{ label?: { show?: boolean } }>)[0].label)?.show).toBe(true);
    const season = screen.getByTestId("agri-season-panel");
    expect(season).toHaveTextContent("How to read: cell = % vs own monthly average");
    expect(season).toHaveTextContent("single-year profile");
    expect(season).toHaveTextContent("Onion 1y");
    expect(season).toHaveTextContent("Wheat 1y");
  });

  it("names every rendered month-profile row and defines the cell", async () => {
    vi.mocked(fetchAgriPrices).mockResolvedValueOnce(
      pricesPayload({
        comparison: [
          {
            key: "wheat",
            label: "Wheat",
            points: [
              { date: "2026-10-17", modal: 2400 },
              { date: "2026-11-17", modal: 2450 },
            ],
          },
          {
            key: "tomato",
            label: "Tomato",
            points: [
              { date: "2026-10-17", modal: 1800 },
              { date: "2026-11-17", modal: 1900 },
            ],
          },
        ],
      }),
    );
    renderPage();
    await settled();

    const season = screen.getByTestId("agri-season-panel");
    for (const label of ["Onion", "Wheat", "Tomato"]) {
      expect(season).toHaveTextContent(`${label} 1y`);
    }
    expect(season).toHaveTextContent("n = observations in tooltip");
  });

  it("dedupes the active commodity when comparison echoes it", async () => {
    vi.mocked(fetchAgriPrices).mockResolvedValue(
      pricesPayload({
        comparison: [
          {
            key: "onion",
            label: "Onion",
            points: [
              { date: "2026-10-17", modal: 2100 },
              { date: "2026-11-17", modal: 2150 },
            ],
          },
          {
            key: "wheat",
            label: "Wheat",
            points: [
              { date: "2026-10-17", modal: 2400 },
              { date: "2026-11-17", modal: 2450 },
            ],
          },
          {
            key: "tomato",
            label: "Tomato",
            points: [
              { date: "2026-10-17", modal: 1850 },
              { date: "2026-11-17", modal: 1800 },
            ],
          },
        ],
      }),
    );
    renderPage();
    await settled();

    const seasonRows = (optionFor("agri-season-chart").yAxis as Array<{ data: string[] }>)[0].data;
    expect(seasonRows).toEqual(["Onion", "Wheat", "Tomato"]);
    expect(new Set(seasonRows).size).toBe(3);
    expect((optionFor("agri-rank-chart").series as unknown[]).length).toBe(3);
    // Hero focus + two context lines, never the selected line twice.
    expect((optionFor().series as unknown[]).length).toBe(3);
  });

  it("draws a sorted min–modal–max dot plot with a separated outlier series", async () => {
    renderPage();
    await settled();

    const option = optionFor("agri-dispersion-chart");
    expect(option.title).toBeUndefined();
    expect(option.legend).toBeUndefined();
    expect((option.series as Array<{ name: string }>).map((series) => series.name)).toEqual([
      "Floor",
      "Min–max",
      "Modal",
      "Outlier",
    ]);
    const xAxis = (option.xAxis as Array<{ splitNumber: number; axisLabel: { formatter: (v: number) => string } }>)[0];
    expect(xAxis.splitNumber).toBeLessThanOrEqual(5);
    expect(xAxis.axisLabel.formatter(2_300_000_000)).toMatch(/^₹[\d.]+Cr$/);
    const markets = (option.yAxis as Array<{ data: string[] }>)[0].data;
    expect(markets).toEqual(["Lasalgaon", "Kolar"]);
    expect(markets.length).toBeLessThanOrEqual(8);
    const panel = screen.getByTestId("agri-dispersion-panel");
    expect(panel).toHaveTextContent("Top-priced mandis");
    expect(panel).toHaveTextContent("IQR/median of these 2");
    expect(panel).toHaveTextContent("outside this set's 1.5×IQR");
  });

  it("selects the hero from the universe grid by click, Enter and Space", async () => {
    renderPage();
    await settled();

    expect(screen.getByTestId("agri-spark-onion")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTestId("agri-spark-wheat")).toHaveAttribute("data-selected", "false");

    fireEvent.click(screen.getByTestId("agri-spark-wheat"));
    await waitFor(() => expect(lastParams().commodity).toBe("wheat"));
    expect(screen.getByTestId("agri-spark-wheat")).toHaveAttribute("data-selected", "true");

    fireEvent.keyDown(screen.getByTestId("agri-spark-tomato"), { key: "Enter" });
    await waitFor(() => expect(lastParams().commodity).toBe("tomato"));

    fireEvent.keyDown(screen.getByTestId("agri-spark-onion"), { key: " " });
    await waitFor(() => expect(lastParams().commodity).toBe("onion"));
  });

  it("keeps the range and source controls visible above a scrolling workspace", async () => {
    renderPage();
    await settled();

    expect(screen.getByTestId("agri-toolbar")).toHaveClass("sticky", "shrink-0");
    expect(screen.getByTestId("agri-page")).toHaveClass(
      "overflow-y-auto",
      "overflow-x-hidden",
      "min-h-0",
    );
    expect(screen.getByTestId("agri-page")).not.toHaveClass("overflow-hidden");
    expect(screen.getByTestId("agri-body")).toHaveClass("overflow-visible", "shrink-0");
    expect(screen.getByTestId("agri-body")).not.toHaveClass("overflow-y-auto", "overflow-hidden");
    expect(screen.getByTestId("agri-body")).not.toHaveAttribute("aria-busy", "true");
    const grid = screen.getByTestId("agri-overview-grid");
    expect(grid).toHaveClass("grid", "shrink-0", "grid-cols-12");
    // A fixed two-row template once squeezed the third-row dispersion panel
    // to 2px inside overflow:hidden. Auto rows keep every panel reachable.
    expect(grid.className).not.toContain("grid-rows-[");
    expectChartRegionsSized();
  });
});

describe("AgriPage layout", () => {
  it("moves the table out of the default Overview and into Data", async () => {
    renderPage();
    await settled();

    expect(screen.getByTestId("agri-chart-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("agri-table-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agri-groups-view")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("agri-view-groups"));
    expect(screen.getByTestId("agri-groups-view")).toBeInTheDocument();
    expect(within(screen.getByTestId("agri-groups-view")).getByTestId("agri-group-overview")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("agri-groups-view")).getByTestId("agri-fluctuation-matrix-panel"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("agri-overview-grid")).not.toBeInTheDocument();

    openDataView();
    expect(screen.getByTestId("agri-data-view")).toBeInTheDocument();
    expect(screen.getByTestId("agri-quotes-table")).toBeInTheDocument();
    expect(screen.queryByTestId("agri-overview-grid")).not.toBeInTheDocument();
    // A scrollable table panel needs a fixed height or the virtual rows grow
    // the panel past the viewport and push its scope footer out of reach.
    expect(screen.getByTestId("agri-table-panel")).toHaveStyle({
      height: "460px",
      flex: "0 0 auto",
    });
    expect(screen.getByTestId("agri-table-scope")).toBeInTheDocument();
  });

  it("renders one compact headline strip instead of a wall of stat cards", async () => {
    renderPage();
    await settled();

    const headline = screen.getByTestId("agri-kpis");
    expect(headline).toHaveClass("flex", "flex-wrap");
    expect(headline).not.toHaveClass("overflow-x-auto");
    expect(screen.queryByTestId("agri-eda-summary")).not.toBeInTheDocument();
    for (const id of ["agri-kpi-chg1w", "agri-kpi-chg1m", "agri-kpi-chg6m"]) {
      expect(within(headline).getByTestId(id), id).toBeInTheDocument();
    }
    expect(screen.getByTestId("agri-kpi-modal")).toHaveTextContent("₹2,150");
  });

  it("stacks the panels with reserved heights and no page-level horizontal scroll at 390", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width: 640px"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    renderPage();
    await settled();

    expect(screen.getByTestId("agri-overview-grid")).toHaveClass("flex", "flex-col");
    expect(screen.getByTestId("agri-overview-grid")).not.toHaveClass("grid");
    expect(screen.getByTestId("agri-page")).toHaveClass(
      "overflow-y-auto",
      "overflow-x-hidden",
      "max-sm:pt-0",
    );
    expect(screen.getByTestId("agri-body")).toHaveClass("overflow-visible");
    expect(screen.getByTestId("agri-body")).not.toHaveClass("overflow-y-auto");
    expect(screen.getByTestId("agri-chart-region")).toHaveClass("min-h-[280px]");
    expect(screen.getByTestId("agri-rank-region")).toHaveClass("min-h-[280px]");
    expect(screen.getByTestId("agri-season-region")).toHaveClass("min-h-[320px]");
    expect(screen.getByTestId("agri-dispersion-region")).toHaveClass("min-h-[300px]");
    for (const [id, height] of CHART_PANEL_HEIGHTS) {
      expect(screen.getByTestId(id), id).toHaveStyle({ "min-height": height });
    }
    expectChartRegionsSized();
    expect(screen.getByTestId("agri-page")).toHaveClass(
      "overflow-y-auto",
      "overflow-x-hidden",
      "min-h-0",
    );
    expect(screen.getByTestId("agri-refresh")).toBeInTheDocument();
  });

  it.each([
    [false, 1000],
    [true, 844],
  ])(
    "keeps the last panel reachable through the single page scrollport (mobile=%s)",
    async (mobile, viewportHeight) => {
      if (mobile) {
        vi.stubGlobal("matchMedia", (query: string) => ({
          matches: query.includes("max-width: 640px"),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }));
      }
      renderPage();
      await settled();

      const root = screen.getByTestId("agri-page");
      const body = screen.getByTestId("agri-body");
      // happy-dom has no layout engine; model a viewport shorter than content.
      Object.defineProperty(root, "scrollHeight", { configurable: true, value: 2400 });
      Object.defineProperty(root, "clientHeight", { configurable: true, value: viewportHeight });
      expect(root.scrollHeight).toBeGreaterThan(root.clientHeight);
      expect(root).toHaveClass("overflow-y-auto", "overflow-x-hidden", "min-h-0");
      expect(body).toHaveClass("overflow-visible", "shrink-0");
      expect(body).not.toHaveClass("overflow-y-auto", "overflow-hidden");

      root.scrollTop = root.scrollHeight - root.clientHeight;
      expect(root.scrollTop).toBeGreaterThan(0);
      expect(screen.getByTestId("agri-dispersion-panel")).toBeInTheDocument();
      expect(screen.getByTestId("agri-toolbar")).toHaveClass("sticky", "top-0");
    },
  );
});
