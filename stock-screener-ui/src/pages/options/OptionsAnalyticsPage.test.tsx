// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { MemoryRouter, Route, createMemoryHistory } from "@solidjs/router";
import { BROKER_AUTH_ACTION } from "@/components/common/BrokerAuthNotice";
import type { OptionsDashboardData } from "../../types/optionsDashboard";

const h = vi.hoisted(() => ({
  setState: (_patch: Record<string, unknown>) => {},
  loadDashboard: vi.fn(),
  abortDashboard: vi.fn(),
  refreshDashboard: vi.fn(),
}));

vi.mock("../../state/optionsDashboard", async () => {
  const { createStore } = await import("solid-js/store");
  const [state, setState] = createStore<Record<string, unknown>>({
    symbol: null,
    status: "idle",
    error: null,
    data: null,
    refreshing: false,
  });
  h.setState = (patch: Record<string, unknown>) => setState(patch);
  return {
    optionsDashboardState: state,
    loadDashboard: (...args: unknown[]) => h.loadDashboard(...args),
    abortDashboard: (...args: unknown[]) => h.abortDashboard(...args),
    refreshDashboard: (...args: unknown[]) => h.refreshDashboard(...args),
  };
});

vi.mock("../../components/options-dashboard/VolatilityPillar", () => ({
  VolatilityPillar: (props: any) => (
    <div
      data-testid="panel-volatility"
      data-symbol={props.data?.symbol ?? ""}
      data-expiry={props.selectedExpiry ?? ""}
      data-gex={props.data?.dealer?.gex?.length ?? -1}
      data-deltaoi={props.data?.positioning?.deltaOi?.length ?? -1}
      data-spread={props.data?.liquidity?.spread?.length ?? -1}
      data-rv={props.data?.realisedVol?.length ?? -1}
    >
      volatility panel
    </div>
  ),
}));
vi.mock("../../components/options-dashboard/PositioningPillar", () => ({
  PositioningPillar: (props: any) => (
    <div data-testid="panel-positioning" data-expiry={props.selectedExpiry ?? ""}>
      positioning panel
    </div>
  ),
}));
vi.mock("../../components/options-dashboard/DealerPillar", () => ({
  DealerPillar: () => <div data-testid="panel-dealer">dealer panel</div>,
}));
vi.mock("../../components/options-dashboard/LiquidityPillar", () => ({
  LiquidityPillar: () => <div data-testid="panel-liquidity">liquidity panel</div>,
}));

import OptionsAnalyticsPage from "./OptionsAnalyticsPage";

function data(symbol = "AAPL"): OptionsDashboardData {
  return {
    symbol,
    spot: 214.5,
    asOf: "2026-11-16T15:00:00+05:30",
    quotesLive: true,
    marketState: "closed",
    sessionDate: "2026-11-16",
    expiries: [
      { date: "2026-11-20" } as OptionsDashboardData["expiries"][number],
      { date: "2026-11-27" } as OptionsDashboardData["expiries"][number],
    ],
    term: [],
    surface: { strikes: [], expiries: [], iv: [], missing: [] },
    levels: {
      callWall: null,
      putWall: null,
      maxPain: null,
      gex: { support: null, resistance: null, fuelUp: null, fuelDown: null },
    },
    probability: {
      model: null,
      flatPop: null,
      skewPop: null,
      expectedPnl: null,
      sigma: null,
      density: [],
      quantiles: { p05: null, p25: null, p50: null, p75: null, p95: null },
      cone: [],
    },
    rv: {
      current: null, rv5: null, rv10: null, rv20: null, rv30: null, source: null,
      cone: { symbol: null, asOf: null, tenors: [], warnings: [] },
      ivVsRv: { rows: [], warnings: [] },
    },
    warnings: [],
    positioning: { deltaOi: [], volume: [] },
    dealer: { gex: [], dex: [], vanna: [], charm: [], theta: [] },
    liquidity: { spread: [], volumeOi: [] },
    realisedVol: [],
  };
}

function renderPage(url = "/options/analytics/aapl") {
  const history = createMemoryHistory();
  history.set({ value: url, replace: true });
  return render(() => (
    <MemoryRouter history={history}>
      <Route path="/options/analytics/:symbol" component={OptionsAnalyticsPage} />
    </MemoryRouter>
  ));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.loadDashboard.mockResolvedValue(null);
  h.setState({
    symbol: "AAPL",
    status: "ready",
    error: null,
    data: data(),
    refreshing: false,
  });
});

afterEach(() => {
  cleanup();
});

describe("OptionsAnalyticsPage — route + fetch", () => {
  it("reads the symbol from the route (case-insensitive) and fetches it once", async () => {
    renderPage("/options/analytics/aapl");

    expect(await screen.findByTestId("analytics-symbol")).toHaveTextContent("AAPL");
    expect(h.loadDashboard).toHaveBeenCalledTimes(1);
    expect(h.loadDashboard).toHaveBeenCalledWith("AAPL");
  });

  it("renders the spot, live badge and the lazy volatility panel with the payload", async () => {
    renderPage();

    expect(await screen.findByTestId("analytics-spot")).toHaveTextContent("214.5");
    expect(screen.getByTestId("analytics-live")).toBeInTheDocument();
    const panel = await screen.findByTestId("panel-volatility");
    expect(panel).toHaveAttribute("data-symbol", "AAPL");
  });

  it("passes the per-strike arrays through to the panel untouched", async () => {
    const rich = data();
    rich.dealer = {
      gex: [{ strike: 100, value: 1 }, { strike: 101, value: 2 }],
      dex: [], vanna: [], charm: [], theta: [],
    };
    rich.positioning = { deltaOi: [{ strike: 100, ce: 1, pe: null }], volume: [] };
    rich.liquidity = {
      spread: [{ strike: 100, expiry: "2026-11-20", spread: 0.2 }],
      volumeOi: [],
    };
    rich.realisedVol = [{ dte: 5, value: 17 }];
    h.setState({ data: rich });

    renderPage();
    const panel = await screen.findByTestId("panel-volatility");
    expect(panel).toHaveAttribute("data-gex", "2");
    expect(panel).toHaveAttribute("data-deltaoi", "1");
    expect(panel).toHaveAttribute("data-spread", "1");
    expect(panel).toHaveAttribute("data-rv", "1");
  });
});

describe("OptionsAnalyticsPage — tabs", () => {
  it("offers exactly the four pillar tabs and switches the lazy panel", async () => {
    renderPage();
    await screen.findByTestId("panel-volatility");

    for (const key of ["volatility", "positioning", "dealer", "liquidity"]) {
      expect(screen.getByTestId(`analytics-pillar-tab-${key}`)).toBeInTheDocument();
    }

    fireEvent.click(screen.getByTestId("analytics-pillar-tab-dealer"));
    expect(await screen.findByTestId("panel-dealer")).toBeInTheDocument();
    expect(screen.queryByTestId("panel-volatility")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("analytics-pillar-tab-positioning"));
    expect(await screen.findByTestId("panel-positioning")).toBeInTheDocument();
  });
});

describe("OptionsAnalyticsPage — expiry selection", () => {
  it("defaults to the front expiry and passes a clicked expiry to the panel", async () => {
    renderPage();
    expect(await screen.findByTestId("panel-volatility")).toHaveAttribute(
      "data-expiry",
      "2026-11-20",
    );

    fireEvent.click(screen.getByTestId("analytics-expiry-2026-11-27"));
    expect(await screen.findByTestId("panel-volatility")).toHaveAttribute(
      "data-expiry",
      "2026-11-27",
    );
  });
});

describe("OptionsAnalyticsPage — error and empty states", () => {
  it("shows an error band and invokes refreshDashboard on Retry", async () => {
    h.setState({ status: "error", error: { kind: "upstream", message: "Service unavailable" } });
    renderPage();

    expect(await screen.findByTestId("analytics-error")).toHaveTextContent("Service unavailable");
    fireEvent.click(screen.getByTestId("analytics-retry"));
    expect(h.refreshDashboard).toHaveBeenCalledTimes(1);
  });

  it("links auth errors to Settings and keeps Retry working", async () => {
    h.setState({ status: "error", error: { kind: "auth", message: "Reconnect Upstox in Settings" } });
    renderPage();

    const link = await screen.findByTestId("analytics-reconnect");
    expect(link).toHaveTextContent(BROKER_AUTH_ACTION);
    expect(link).toHaveAttribute("href", "/settings");

    const retry = screen.getByTestId("analytics-retry");
    expect(retry).toBeInTheDocument();
    fireEvent.click(retry);
    expect(h.refreshDashboard).toHaveBeenCalledTimes(1);
  });

  it("does not show the broker reconnect link for a generic error", async () => {
    h.setState({ status: "error", error: { kind: "upstream", message: "Service unavailable" } });
    renderPage();

    await screen.findByTestId("analytics-error");
    expect(screen.queryByTestId("analytics-reconnect")).not.toBeInTheDocument();
  });

  it("shows the loading indicator with no payload and an empty message for no expiries", async () => {
    h.setState({ status: "loading", data: null });
    renderPage();
    expect(await screen.findByTestId("analytics-loading")).toBeInTheDocument();
    cleanup();

    h.setState({
      status: "ready",
      data: { ...data(), expiries: [] },
    });
    renderPage();
    expect(await screen.findByTestId("analytics-empty")).toBeInTheDocument();
  });
});

describe("OptionsAnalyticsPage — keyboard parity", () => {
  it("arrow keys, Home and End switch pillars and keep aria-selected in sync", async () => {
    renderPage();
    await screen.findByTestId("panel-volatility");
    expect(screen.getByTestId("analytics-pillar-list")).toHaveAttribute("role", "tablist");

    const vol = screen.getByTestId("analytics-pillar-tab-volatility");
    const pos = screen.getByTestId("analytics-pillar-tab-positioning");
    const liq = screen.getByTestId("analytics-pillar-tab-liquidity");
    expect(vol).toHaveAttribute("aria-selected", "true");

    vol.focus();
    fireEvent.keyDown(vol, { key: "ArrowRight" });
    expect(await screen.findByTestId("panel-positioning")).toBeInTheDocument();
    expect(pos).toHaveAttribute("aria-selected", "true");
    expect(vol).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(pos, { key: "End" });
    expect(await screen.findByTestId("panel-liquidity")).toBeInTheDocument();
    expect(liq).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(liq, { key: "Home" });
    expect(await screen.findByTestId("panel-volatility")).toBeInTheDocument();
    expect(vol).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(vol, { key: "ArrowLeft" });
    expect(await screen.findByTestId("panel-liquidity")).toBeInTheDocument();
  });

  it("keeps visible labels, tab semantics and a focus ring on the pillar tabs", () => {
    renderPage();
    const vol = screen.getByTestId("analytics-pillar-tab-volatility");
    expect(vol).toHaveTextContent("VOLATILITY");
    expect(vol).toHaveAttribute("role", "tab");
    expect(vol).toHaveClass("focus-visible:ring-1");
    expect(vol).toHaveClass("focus-visible:ring-fin-text");
  });

  it("is a flex column so the active pillar and its charts fill the body", async () => {
    renderPage();
    const panel = await screen.findByTestId("panel-volatility");
    const body = screen.getByTestId("analytics-body");
    expect(body).toHaveClass("flex");
    expect(body).toHaveClass("flex-col");
    expect(body).toHaveClass("flex-1");
    expect(body).toHaveClass("min-h-0");
    // A plain block here is the bug: the panel's flex-1 chain goes inert and
    // every chart falls back to its min height.
    expect(body.firstElementChild).toBe(panel);
  });

  it("expiry chips are keyboard-selectable with a visible focus ring", async () => {
    renderPage();
    await screen.findByTestId("panel-volatility");
    const chip = screen.getByTestId("analytics-expiry-2026-11-27");
    expect(chip.tagName).toBe("BUTTON");
    expect(chip).toHaveAttribute("role", "checkbox");
    expect(chip).toHaveAttribute("aria-checked", "false");
    expect(chip).toHaveClass("focus-visible:ring-1");

    chip.focus();
    fireEvent.keyDown(chip, { key: "Enter" });
    // Native buttons activate on Enter via a click; happy-dom needs it fired explicitly.
    fireEvent.click(chip);
    expect(await screen.findByTestId("panel-volatility")).toHaveAttribute("data-expiry", "2026-11-27");
  });

  it("never strands focus after a keyboard switch — an active tab and a panel always remain", async () => {
    renderPage();
    await screen.findByTestId("panel-volatility");
    const list = screen.getByTestId("analytics-pillar-list");
    for (let i = 0; i < 4; i++) {
      const active = list.querySelector('[role="tab"][aria-selected="true"]') as HTMLElement;
      fireEvent.keyDown(active, { key: "ArrowRight" });
      expect(list.querySelector('[role="tab"][aria-selected="true"]')).not.toBeNull();
      expect(document.activeElement?.getAttribute("role")).toBe("tab");
      expect(screen.getByTestId("analytics-body")).not.toBeEmptyDOMElement();
    }
  });
});
