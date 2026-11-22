// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { FnoScreenerTab } from "./FnoScreenerTab";
import { buildFnoScreenerUrl, type FnoScreenerParams } from "../../api/fnoScreener";
import * as palette from "@/ui/palette";

type PayoffOption = {
  xAxis?: { data?: string[] };
  series?: { name?: string; lineStyle?: { color?: string }; data?: (number | null)[] }[];
  graphic?: { style?: { text?: string } }[];
};
const lastPayoffOption = () =>
  (chartStub.setOption.mock.calls.at(-1)?.[0] ?? {}) as PayoffOption;

const mockFetchFnoScreener = vi.hoisted(() => vi.fn());
const routerMocks = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("../../api/fnoScreener", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/fnoScreener")>();
  return { ...actual, fetchFnoScreener: mockFetchFnoScreener };
});

// FnoScreenerTab now owns the in-app symbol navigation; keep the router mock
// local to this suite so the tab renders without mounting a full Router.
vi.mock("@solidjs/router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useNavigate: () => routerMocks.navigate };
});

// The row detail now renders the shared ECharts payoff core. Stub the loader so
// happy-dom never loads a real canvas and the test can assert the series it paints.
const { chartStub } = vi.hoisted(() => ({
  chartStub: {
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));
vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({ init: vi.fn(() => chartStub) })),
}));

const baseResponse = {
  status: "ok" as const,
  as_of: "2026-11-10T14:30:00+05:30",
  expiry: "2026-11-20",
  expiries: [
    { date: "2026-11-13", days_to_expiry: 3 },
    { date: "2026-11-20", days_to_expiry: 10 },
    { date: "2026-12-18", days_to_expiry: 38 },
  ],
  preset: "cheap_momentum",
  scanned: 120,
  stale: false,
  warnings: [],
  errors: [],
  rows: [
    {
      symbol: "RELIANCE",
      spot: 2946,
      d1: 1.25,
      d5: 4.6,
      vol_ratio: 1.4,
      above20: 1,
      setup: "BREAKOUT",
      call: "CE",
      strike: 3000,
      otm_pct: 1.83,
      premium: 45.5,
      cost_lot: 9100,
      breakeven: 3045.5,
      pop: 62,
      delta: 0.55,
      gamma: 0.012,
      theta: -18.5,
      vega: 0.42,
      iv: 22.5,
      oi: 125000,
      volume: 45000,
      spread_pct: 0.8,
      move_2pct_est: 3.4,
    },
    {
      symbol: "TCS",
      spot: 4150,
      d1: -0.5,
      d5: 2.1,
      vol_ratio: 0.9,
      above20: 0,
      setup: "BASE",
      call: "PE",
      strike: 4200,
      otm_pct: 1.2,
      premium: 32,
      cost_lot: 6400,
      breakeven: 4168,
      pop: 48,
      delta: -0.4,
      gamma: 0.008,
      theta: -12,
      vega: 0.31,
      iv: 19,
      oi: 98000,
      volume: 30000,
      spread_pct: 1.1,
      move_2pct_est: 1.2,
    },
    {
      symbol: "NMDC",
      spot: 145,
      d1: 0.8,
      d5: 3.2,
      vol_ratio: 1.1,
      above20: 1,
      setup: "NEAR HIGH",
      call: "CE",
      strike: 150,
      otm_pct: 3.4,
      premium: 18,
      cost_lot: 3600,
      breakeven: 168,
      pop: 55,
      delta: 0.45,
      gamma: 0.02,
      theta: -12,
      vega: 0.3,
      iv: 25,
      oi: 80000,
      volume: 20000,
      spread_pct: 1.2,
      move_2pct_est: 2.0,
    },
    {
      symbol: "LT",
      spot: 3800,
      d1: -1.0,
      d5: 1.5,
      vol_ratio: 0.8,
      above20: 0,
      setup: "WEAK",
      call: "PE",
      strike: 3900,
      otm_pct: 2.6,
      premium: 89,
      cost_lot: 17800,
      breakeven: 3811,
      pop: 40,
      delta: -0.3,
      gamma: 0.015,
      theta: -22,
      vega: 0.5,
      iv: 28,
      oi: 110000,
      volume: 35000,
      spread_pct: 0.9,
      move_2pct_est: 0.8,
    },
    {
      symbol: "IRFC",
      spot: 162,
      d1: 3.1,
      d5: 9.4,
      vol_ratio: 1.6,
      above20: 1,
      setup: "BREAKOUT",
      call: "CE",
      strike: 90,
      otm_pct: 2.5,
      premium: 5.4,
      cost_lot: 3240,
      breakeven: 95.4,
      pop: 58,
      delta: 0.6,
      gamma: 0.03,
      theta: -9,
      vega: 0.18,
      iv: 31,
      oi: 420000,
      volume: 180000,
      spread_pct: 1.5,
      move_2pct_est: 4.2,
    },
    {
      symbol: "IRFC",
      spot: 162,
      d1: 3.1,
      d5: 9.4,
      vol_ratio: 1.6,
      above20: 1,
      setup: "BREAKOUT",
      call: "CE",
      strike: 91,
      otm_pct: 3.4,
      premium: 3.9,
      cost_lot: 2340,
      breakeven: 94.9,
      pop: 52,
      delta: 0.52,
      gamma: 0.028,
      theta: -8.5,
      vega: 0.16,
      iv: 30,
      oi: 310000,
      volume: 95000,
      spread_pct: 1.2,
      move_2pct_est: 3.1,
    },
  ],
  matched: 6,
};

const renderTab = () =>
  render(() => (
    <UIProvider>
      <FnoScreenerTab />
    </UIProvider>
  ));

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchFnoScreener.mockResolvedValue(baseResponse);
});

describe("FnoScreenerTab", () => {
  it("renders the toolbar and fetches defaults on mount", async () => {
    renderTab();

    expect(screen.getByTestId("fno-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("fno-title")).toHaveTextContent("F&O MOMENTUM");
    expect(screen.getByTestId("fno-preset-cheap_momentum")).toBeInTheDocument();
    expect(screen.getByTestId("fno-preset-breakout")).toBeInTheDocument();
    expect(mockFetchFnoScreener).toHaveBeenCalledTimes(1);

    const firstParams = mockFetchFnoScreener.mock.calls[0][0] as FnoScreenerParams;
    expect(firstParams).toMatchObject({ preset: "cheap_momentum", limit: 50 });
    expect(firstParams.max_cost).toBeUndefined();
    expect(firstParams.expiry).toBeUndefined();
    expect(firstParams.min_pop).toBeUndefined();
    expect(buildFnoScreenerUrl(firstParams)).toContain("/api/options/screener?");
    expect(buildFnoScreenerUrl(firstParams)).not.toContain("expiry=");
    expect(buildFnoScreenerUrl(firstParams)).not.toContain("min_pop");

    expect(screen.getByTestId("fno-loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("fno-row-RELIANCE")).toBeInTheDocument());
    expect(screen.getByTestId("fno-table")).toBeInTheDocument();
  });

  it("clicking the symbol navigates once to the chart route without expanding the row", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByTestId("fno-cell-symbol-RELIANCE")).toBeInTheDocument());

    const symbol = screen.getByTestId("fno-cell-symbol-RELIANCE");
    expect(symbol.tagName).toBe("BUTTON");
    await fireEvent.click(symbol);

    expect(routerMocks.navigate).toHaveBeenCalledTimes(1);
    expect(routerMocks.navigate).toHaveBeenCalledWith("/chart/RELIANCE");
    // The symbol click must not also fire a row-level detail action.
    expect(screen.queryByTestId("fno-row-detail")).not.toBeInTheDocument();
  });

  it("renders rows with formatted cells once data resolves", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByTestId("fno-row-RELIANCE")).toBeInTheDocument());

    expect(screen.getByTestId("fno-cell-symbol-RELIANCE")).toHaveTextContent("RELIANCE");
    expect(screen.getByTestId("fno-cell-setup-RELIANCE")).toHaveTextContent("BRK");
    expect(screen.getByTestId("fno-cell-call-RELIANCE")).toHaveTextContent("CE");
    expect(screen.getByTestId("fno-cell-spot-RELIANCE")).toHaveTextContent("₹2,946.00");
    expect(screen.getByTestId("fno-cell-d1-RELIANCE")).toHaveTextContent("+1.25%");
    expect(screen.getByTestId("fno-cell-pop-RELIANCE")).toHaveTextContent("62.00%");
    expect(screen.getByTestId("fno-cell-iv-RELIANCE")).toHaveTextContent("22.50%");
    expect(screen.getByTestId("fno-cell-move-RELIANCE")).toHaveTextContent("+3.40%");
    expect(screen.getByTestId("fno-cell-oi-RELIANCE")).toHaveTextContent("1.3L");
    expect(screen.getByTestId("fno-cell-vol-TCS")).toHaveTextContent("0.90×");

    // Numeric cells must be mono + tabular or the columns stop lining up.
    for (const cell of [
      "spot",
      "d1",
      "d5",
      "vol",
      "otm",
      "premium",
      "cost",
      "pop",
      "delta",
      "gamma",
      "theta",
      "vega",
      "iv",
      "oi",
      "spread",
      "move",
    ]) {
      const el = screen.getByTestId(`fno-cell-${cell}-RELIANCE`);
      expect(el.className, cell).toContain("font-mono");
      expect(el.className, cell).toContain("tabular-nums");
      expect(el.className, cell).toContain("text-right");
    }
    expect(screen.getByTestId("fno-cell-call-RELIANCE").className).toContain("text-left");
  });

  it("preset switch triggers a refetch and aborts the previous request", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByTestId("fno-row-RELIANCE")).toBeInTheDocument());
    expect(mockFetchFnoScreener).toHaveBeenCalledTimes(1);
    const firstSignal = mockFetchFnoScreener.mock.calls[0][1]?.signal as AbortSignal;

    fireEvent.click(screen.getByTestId("fno-preset-max_torque"));

    await waitFor(() => expect(mockFetchFnoScreener).toHaveBeenCalledTimes(2));
    const lastParams = mockFetchFnoScreener.mock.calls.at(-1)![0] as FnoScreenerParams;
    expect(lastParams.preset).toBe("max_torque");
    expect(firstSignal.aborted).toBe(true);
    const lastSignal = mockFetchFnoScreener.mock.calls.at(-1)![1]?.signal as AbortSignal;
    expect(lastSignal).toBeInstanceOf(AbortSignal);
    expect(lastSignal).not.toBe(firstSignal);
    expect(lastSignal.aborted).toBe(false);
  });

  it("expiry change refetches with the selected expiry", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByTestId("fno-row-RELIANCE")).toBeInTheDocument());

    fireEvent.input(within(screen.getByTestId("fno-expiry-select")).getByRole("combobox"), {
      target: { value: "2026-11-13" },
    });

    await waitFor(() => {
      const lastParams = mockFetchFnoScreener.mock.calls.at(-1)![0] as FnoScreenerParams;
      expect(lastParams.expiry).toBe("2026-11-13");
    });
  });

  it("min POP change refetches with the entered value", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByTestId("fno-row-RELIANCE")).toBeInTheDocument());

    const input = screen.getByTestId("fno-min-pop-min-input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "" } });
    fireEvent.input(input, { target: { value: "40" } });

    await waitFor(() => {
      const lastParams = mockFetchFnoScreener.mock.calls.at(-1)![0] as FnoScreenerParams;
      expect(lastParams.min_pop).toBe(40);
    });
  });

  it("renders both filter pairs as dual-thumb ranges", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByTestId("fno-row-RELIANCE")).toBeInTheDocument());

    // Two ranges × two thumbs each.
    expect(screen.getAllByRole("slider")).toHaveLength(4);
    expect(screen.getByTestId("fno-max-cost-select-slider-min")).toBeInTheDocument();
    expect(screen.getByTestId("fno-max-cost-select-slider-max")).toBeInTheDocument();
    expect(screen.getByTestId("fno-min-pop-slider-min")).toBeInTheDocument();
    expect(screen.getByTestId("fno-min-pop-slider-max")).toBeInTheDocument();
  });

  it("cost range sends the cap to the backend and applies the floor locally", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByTestId("fno-row-LT")).toBeInTheDocument());

    fireEvent.input(screen.getByTestId("fno-max-cost-select-max-input"), {
      target: { value: "8000" },
    });

    await waitFor(() => {
      const lastParams = mockFetchFnoScreener.mock.calls.at(-1)![0] as FnoScreenerParams;
      expect(lastParams.max_cost).toBe(8000);
    });

    // The floor is a local predicate over the fetched rows: no extra request.
    fireEvent.input(screen.getByTestId("fno-max-cost-select-min-input"), {
      target: { value: "5000" },
    });
    await waitFor(() => expect(screen.queryByTestId("fno-row-NMDC")).not.toBeInTheDocument());
    expect(screen.getByTestId("fno-row-TCS")).toBeInTheDocument();
    expect(screen.queryByTestId("fno-row-LT")).not.toBeInTheDocument();
    expect(mockFetchFnoScreener).toHaveBeenCalledTimes(2);
  });

  it("POP range applies its ceiling locally without refetching", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByTestId("fno-row-RELIANCE")).toBeInTheDocument());

    fireEvent.input(screen.getByTestId("fno-min-pop-max-input"), {
      target: { value: "50" },
    });

    await waitFor(() => expect(screen.queryByTestId("fno-row-RELIANCE")).not.toBeInTheDocument());
    expect(screen.getByTestId("fno-row-TCS")).toBeInTheDocument();
    expect(screen.getByTestId("fno-row-LT")).toBeInTheDocument();
    expect(screen.getByTestId("fno-row-count")).toHaveTextContent(/2 symbols \/ 2 contracts/);
    expect(mockFetchFnoScreener).toHaveBeenCalledTimes(1);
  });

  it("refresh action icon refetches with refresh=true", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByTestId("fno-row-RELIANCE")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("fno-refresh"));

    await waitFor(() => expect(mockFetchFnoScreener).toHaveBeenCalledTimes(2));
    const lastParams = mockFetchFnoScreener.mock.calls.at(-1)![0] as FnoScreenerParams;
    expect(lastParams.refresh).toBe(true);
  });

  it("renders the as-of and STALE badge when the backend marks data stale", async () => {
    mockFetchFnoScreener.mockResolvedValueOnce({ ...baseResponse, stale: true });
    renderTab();
    await waitFor(() => expect(screen.getByTestId("fno-row-RELIANCE")).toBeInTheDocument());
    expect(screen.getByTestId("fno-as-of")).toHaveTextContent("as of 14:30");
    expect(screen.getByTestId("fno-stale-badge")).toHaveTextContent("STALE");
  });

  it("survives a degraded payload without printing undefined or NaN", async () => {
    mockFetchFnoScreener.mockResolvedValueOnce({
      ...baseResponse,
      as_of: undefined,
      expiries: undefined,
      errors: undefined,
      warnings: undefined,
    } as never);
    renderTab();
    await waitFor(() => expect(screen.getByTestId("fno-row-RELIANCE")).toBeInTheDocument());
    expect(screen.getByTestId("fno-as-of")).toHaveTextContent("as of —");
    expect(screen.getByTestId("fno-expiry-select")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/undefined|NaN/);
  });

  it("renders non-finite money cells as a dash, not ₹NaN", async () => {
    mockFetchFnoScreener.mockResolvedValueOnce({
      ...baseResponse,
      rows: [{
        ...baseResponse.rows[0],
        premium: Number.NaN,
        cost_lot: Number.NaN,
        breakeven: Number.NaN,
      }],
    });
    renderTab();
    await waitFor(() => expect(screen.getByTestId("fno-row-RELIANCE")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("fno-expand-RELIANCE"));
    await waitFor(() => expect(screen.getByTestId("fno-detail-premium")).toBeInTheDocument());

    for (const id of [
      "fno-detail-premium",
      "fno-detail-cost",
      "fno-detail-breakeven",
      "fno-detail-max-loss",
    ]) {
      expect(screen.getByTestId(id)).toHaveTextContent("—");
    }
    expect(screen.getByTestId("fno-row-detail").textContent).not.toMatch(/NaN|undefined/);
  });

  it("renders the empty state when there are no matches", async () => {
    mockFetchFnoScreener.mockResolvedValueOnce({ ...baseResponse, rows: [], matched: 0 });
    renderTab();
    await waitFor(() => expect(screen.getByTestId("fno-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("fno-table")).not.toBeInTheDocument();
  });

  it("renders the error state and does not crash", async () => {
    mockFetchFnoScreener.mockRejectedValueOnce(new Error("upstream down"));
    renderTab();
    await waitFor(() => expect(screen.getByTestId("fno-error")).toBeInTheDocument());
    expect(screen.getByText(/F&O screener failed: upstream down/)).toBeInTheDocument();
    expect(screen.queryByTestId("fno-table")).not.toBeInTheDocument();
  });

  it("expands a row to show the Greeks/payoff detail", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByTestId("fno-row-RELIANCE")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("fno-expand-RELIANCE"));
    await waitFor(() => expect(screen.getByTestId("fno-detail-breakeven")).toBeInTheDocument());

    expect(screen.getByTestId("fno-row-detail")).toBeInTheDocument();
    expect(screen.getByTestId("fno-detail-premium")).toHaveTextContent("₹45.50");
    expect(screen.getByTestId("fno-detail-cost")).toHaveTextContent("₹9,100");
    expect(screen.getByTestId("fno-detail-breakeven")).toHaveTextContent("₹3,045.50");
    expect(screen.getByTestId("fno-detail-pop")).toHaveTextContent("+62.00%");
    expect(screen.getByTestId("fno-detail-d1")).toHaveTextContent("+1.25%");
    expect(screen.getByTestId("fno-detail-d5")).toHaveTextContent("+4.60%");
    expect(screen.getByTestId("fno-detail-move2")).toHaveTextContent("+3.40%");
  });

  it("renders the shared payoff core on row expand, not the old single-line chart", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByTestId("fno-row-RELIANCE")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("fno-expand-RELIANCE"));
    await waitFor(() => expect(screen.getByTestId("fno-detail-breakeven")).toBeInTheDocument());
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    expect(screen.getByTestId("fno-payoff-RELIANCE")).toBeInTheDocument();
    expect(screen.queryByTestId("payoff-chart")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mock-payoff-chart")).not.toBeInTheDocument();
    expect(screen.getByTestId("options-payoff-footer")).toBeInTheDocument();
  });

  it("prices a long call with a bounded max loss and green profit above the strike", async () => {
    // Integer premium keeps the expected -₹40 loss exact after the chart rounds.
    const call = { ...baseResponse.rows[0], premium: 40, iv: 22.5 };
    mockFetchFnoScreener.mockResolvedValueOnce({ ...baseResponse, rows: [call], matched: 1 });
    renderTab();
    await waitFor(() => expect(screen.getByTestId("fno-row-RELIANCE")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("fno-expand-RELIANCE"));
    await waitFor(() => expect(screen.getByTestId("fno-payoff-RELIANCE")).toBeInTheDocument());
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const option = lastPayoffOption();
    const profit = option.series!.find((s) => s.lineStyle?.color === palette.POSITIVE)!;
    const loss = option.series!.find((s) => s.lineStyle?.color === palette.NEGATIVE)!;
    expect(profit).toBeDefined();
    expect(loss).toBeDefined();

    const spots = option.xAxis!.data!.map(Number);
    spots.forEach((spot, i) => {
      if (spot > call.strike + call.premium) {
        expect(profit.data![i]).not.toBeNull();
        expect(loss.data![i]).toBeNull();
      } else if (spot < call.strike + call.premium) {
        expect(loss.data![i]).not.toBeNull();
        expect(profit.data![i]).toBeNull();
      }
    });
    // A single long call loses exactly the premium at every spot below breakeven.
    const losses = loss.data!.filter((v): v is number => v !== null);
    expect(Math.min(...losses)).toBe(-call.premium);
    expect(screen.getByTestId("options-max-pnl-value")).toHaveTextContent("∞");
    expect(screen.getByTestId("options-max-pnl-value")).toHaveTextContent("−40");

    // 22.5 is vol points on the API row; the core reads a 0.225 decimal.
    expect(option.graphic?.[0]?.style?.text).toBe("flat vol 22.5%");
  });

  it("prices a PE row as a long put, not a long call", async () => {
    // TCS is a PE row; booking it as a CE paints a mirrored payoff.
    const put = { ...baseResponse.rows[1], premium: 40, iv: 19 };
    mockFetchFnoScreener.mockResolvedValueOnce({ ...baseResponse, rows: [put], matched: 1 });
    renderTab();
    await waitFor(() => expect(screen.getByTestId("fno-row-TCS")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("fno-expand-TCS"));
    await waitFor(() => expect(screen.getByTestId("fno-payoff-TCS")).toBeInTheDocument());
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const option = lastPayoffOption();
    const profit = option.series!.find((s) => s.lineStyle?.color === palette.POSITIVE)!;
    const loss = option.series!.find((s) => s.lineStyle?.color === palette.NEGATIVE)!;
    const spots = option.xAxis!.data!.map(Number);
    spots.forEach((spot, i) => {
      if (spot < put.strike - put.premium) {
        expect(profit.data![i]).not.toBeNull();
        expect(loss.data![i]).toBeNull();
      } else if (spot > put.strike - put.premium) {
        expect(loss.data![i]).not.toBeNull();
        expect(profit.data![i]).toBeNull();
      }
    });
    // A long put tops out at (strike − premium) × lot and loses the premium above the strike.
    expect(Math.min(...loss.data!.filter((v): v is number => v !== null))).toBe(-put.premium);
    expect(screen.getByTestId("options-max-pnl-value")).toHaveTextContent("−40");
  });

  it("sorts rows by premium when the PREMIUM header is clicked", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByTestId("fno-row-RELIANCE")).toBeInTheDocument());

    const firstSymbol = () => screen.getAllByTestId(/^fno-cell-symbol-/)[0].textContent;

    // Default order is move_2pct_est descending → IRFC (4.2) first now.
    expect(firstSymbol()).toBe("IRFC");

    const clickPremiumHeader = () => fireEvent.click(screen.getByText(/PREMIUM/));
    clickPremiumHeader();
    // Premium is numeric, so the first click sorts biggest-first (TanStack's
    // auto-sort contract) → LT (89) first, and IRFC (3.9) last.
    expect(firstSymbol()).toBe("LT");

    clickPremiumHeader();
    // Second click flips to ascending → IRFC 91 CE (lowest premium, 3.9) first.
    expect(firstSymbol()).toBe("IRFC");
  });

  it("shows one row per symbol by default, deduping contracts", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByTestId("fno-row-IRFC")).toBeInTheDocument());

    // Two IRFC contracts exist in the payload; symbol mode keeps only the first.
    expect(screen.getAllByTestId("fno-row-IRFC")).toHaveLength(1);
    expect(screen.getByTestId("fno-row-count")).toHaveTextContent(/5 symbols \/ 6 contracts/);
    expect(mockFetchFnoScreener).toHaveBeenCalledTimes(1);
  });

  it("switching to All contracts shows every contract row", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByTestId("fno-row-IRFC")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "All contracts" }));

    expect(screen.getAllByTestId("fno-row-IRFC")).toHaveLength(2);
    expect(screen.getByTestId("fno-row-count")).toHaveTextContent(/5 symbols \/ 6 contracts/);
    // Client-side only — no refetch.
    expect(mockFetchFnoScreener).toHaveBeenCalledTimes(1);
  });

  it("switching back to Best per symbol collapses to one row per symbol", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByTestId("fno-row-IRFC")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "All contracts" }));
    await waitFor(() => expect(screen.getAllByTestId("fno-row-IRFC")).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "Best per symbol" }));
    await waitFor(() => expect(screen.getAllByTestId("fno-row-IRFC")).toHaveLength(1));
    expect(screen.getByTestId("fno-row-count")).toHaveTextContent(/5 symbols \/ 6 contracts/);
  });
});
