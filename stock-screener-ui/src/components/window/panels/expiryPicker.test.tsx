// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createMemo, type Accessor } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import { fetchNiftyExpiries, fetchOptionsExpiries } from "@/api/reportNifty";
import { fetchChain } from "@/api/optionsDock";
import { fetchAnalytics } from "../../../api/optionsAnalytics";
import { __resetAnalytics } from "../../../state/optionsAnalytics";
import type { DockPanelContext, DockPanelSpec } from "../../dock/types";
import { OPTIONS_CHAIN_PANEL } from "./optionsChain";
import { OPTIONS_POSITIONING_PANEL } from "./optionsPositioning";
import { OPTIONS_ANALYTICS_PANEL } from "./optionsAnalytics";

vi.mock("@/api/reportNifty", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/reportNifty")>();
  return {
    ...actual,
    fetchNiftyExpiries: vi.fn(),
    fetchOptionsExpiries: vi.fn(),
  };
});
vi.mock("@/api/optionsDock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/optionsDock")>();
  return { ...actual, fetchChain: vi.fn() };
});
vi.mock("../../../api/optionsAnalytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/optionsAnalytics")>();
  return { ...actual, fetchAnalytics: vi.fn() };
});
vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({
    init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), on: vi.fn() }),
  })),
}));

const niftyExpiries = vi.mocked(fetchNiftyExpiries);
const optionsExpiries = vi.mocked(fetchOptionsExpiries);
const chain = vi.mocked(fetchChain);
const analytics = vi.mocked(fetchAnalytics);
const fetchMock = vi.fn();

const isoAfter = (days: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const nearExpiry = () => isoAfter(3);
const farExpiry = () => isoAfter(21);

function direct(spec: DockPanelSpec, ctx: Accessor<DockPanelContext>) {
  const data = createMemo(() => spec.data?.(ctx));
  return <>{spec.mount(ctx, { data, commands: {} })}</>;
}

function mountThree(context: DockPanelContext) {
  const ctx = () => context;
  return render(() => (
    <UIProvider>
      {direct(OPTIONS_CHAIN_PANEL, ctx)}
      {direct(OPTIONS_POSITIONING_PANEL, ctx)}
      {direct(OPTIONS_ANALYTICS_PANEL, ctx)}
    </UIProvider>
  ));
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  niftyExpiries.mockReset();
  optionsExpiries.mockReset();
  chain.mockReset();
  analytics.mockReset();
  fetchMock.mockReset();
  __resetAnalytics();
  niftyExpiries.mockImplementation(async () => [
    { date: nearExpiry() },
    { date: farExpiry() },
  ]);
  optionsExpiries.mockImplementation(async () => [nearExpiry(), farExpiry()]);
  chain.mockImplementation(async () => ({
    expiry: nearExpiry(),
    spot: 100,
    pcr: 1,
    atmIv: 14,
    spotChangePct: 0,
    rows: [],
    asOf: null,
    levels: null,
  }));
  analytics.mockImplementation(async () => ({
    symbol: "NIFTY",
    spot: 100,
    asOf: null,
    quotesLive: true,
    expiries: [],
    term: [],
    surface: { strikes: [], expiries: [], iv: [], missing: [] },
    levels: {
      callWall: null,
      putWall: null,
      maxPain: null,
      gex: { support: null, resistance: null, fuelUp: null, fuelDown: null },
    },
    probability: {
      model: "flat",
      flatPop: null,
      skewPop: null,
      expectedPnl: null,
      sigma: null,
      density: [],
      quantiles: { p05: null, p25: null, p50: null, p75: null, p95: null },
      cone: [],
    },
    warnings: [],
  }));
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ status: "error" }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  __resetAnalytics();
  vi.unstubAllGlobals();
});

describe("shared expiry fetch", () => {
  it("(c) three options windows for the same symbol make one expiries request", async () => {
    mountThree({ symbol: "NIFTY", expiry: undefined });

    await waitFor(() =>
      expect(screen.getAllByTestId("options-chain-expiry-picker")).toHaveLength(1),
    );
    expect(screen.getByTestId("options-positioning-expiry-picker")).toBeInTheDocument();
    expect(screen.getByTestId("options-analytics-expiry-picker")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(screen.getByTestId("options-chain-expiry-picker")).getAllByRole("option"),
      ).toHaveLength(2),
    );
    expect(niftyExpiries).toHaveBeenCalledTimes(1);
    expect(optionsExpiries).not.toHaveBeenCalled();
  });

  it("(c) different symbols are keyed separately", async () => {
    const ctx = (symbol: string): DockPanelContext => ({ symbol, expiry: undefined });
    render(() => (
      <UIProvider>
        {direct(OPTIONS_CHAIN_PANEL, () => ctx("NIFTY"))}
        {direct(OPTIONS_CHAIN_PANEL, () => ctx("RELIANCE"))}
      </UIProvider>
    ));

    await waitFor(() =>
      expect(screen.getAllByTestId("options-chain-expiry-picker")).toHaveLength(2),
    );
    await waitFor(() =>
      expect(
        screen.getAllByTestId("options-chain-expiry-picker").every((p) => within(p).getAllByRole("option").length === 2),
      ).toBe(true),
    );
    expect(niftyExpiries).toHaveBeenCalledTimes(1);
    expect(optionsExpiries).toHaveBeenCalledTimes(1);
    expect(optionsExpiries).toHaveBeenCalledWith("RELIANCE", expect.any(AbortSignal));
  });
});
