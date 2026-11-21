// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { createMemo } from "solid-js";
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import {
  BROKER_AUTH_ACTION,
  BROKER_AUTH_MESSAGE,
  BROKER_AUTH_MESSAGE_TESTID,
} from "@/components/common/BrokerAuthNotice";
import { fetchChain, OptionDockError } from "@/api/optionsDock";
import { getPositioning, PositioningApiError } from "@/api/upstoxOptions";
import type { DockPanelContext } from "../../components/dock/types";
import { OPTIONS_CHAIN_PANEL } from "../../components/window/panels/optionsChain";
import { PositioningPanel } from "../../components/options/Positioning/PositioningPanel";
import OptionsAnalyticsPage from "./OptionsAnalyticsPage";

const h = vi.hoisted(() => ({
  setState: (_patch: Record<string, unknown>) => {},
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
    loadDashboard: vi.fn(async () => null),
    abortDashboard: vi.fn(),
    refreshDashboard: vi.fn(),
  };
});

vi.mock("@/api/optionsDock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/optionsDock")>();
  return { ...actual, fetchChain: vi.fn() };
});

vi.mock("@/api/reportNifty", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/reportNifty")>();
  return {
    ...actual,
    fetchNiftyExpiries: vi.fn(async () => []),
    fetchOptionsExpiries: vi.fn(async () => []),
  };
});

vi.mock("@/api/upstoxOptions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/upstoxOptions")>();
  return { ...actual, getPositioning: vi.fn() };
});

vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({
    init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), on: vi.fn() }),
  })),
}));

vi.mock("../../components/options-dashboard/VolatilityPillar", () => ({
  VolatilityPillar: () => <div data-testid="panel-volatility" />,
}));
vi.mock("../../components/options-dashboard/PositioningPillar", () => ({
  PositioningPillar: () => <div data-testid="panel-positioning" />,
}));
vi.mock("../../components/options-dashboard/DealerPillar", () => ({
  DealerPillar: () => <div data-testid="panel-dealer" />,
}));
vi.mock("../../components/options-dashboard/LiquidityPillar", () => ({
  LiquidityPillar: () => <div data-testid="panel-liquidity" />,
}));

function DirectChain(props: { ctx: () => DockPanelContext }) {
  const data = createMemo(() => OPTIONS_CHAIN_PANEL.data?.(props.ctx));
  return <>{OPTIONS_CHAIN_PANEL.mount(props.ctx, { data, commands: {} })}</>;
}

function renderThreeSurfaces() {
  const history = createMemoryHistory();
  history.set({ value: "/options/analytics/nifty", replace: true });
  const ctx = (): DockPanelContext => ({
    symbol: "NIFTY",
    market: "india",
    timeframe: "1m",
    expiry: "2026-11-26",
  });
  return render(() => (
    <UIProvider>
      <div data-testid="surface-chain">
        <DirectChain ctx={ctx} />
      </div>
      <div data-testid="surface-positioning">
        <PositioningPanel underlying="NIFTY" expiry="2026-11-26" />
      </div>
      <MemoryRouter history={history}>
        <Route path="/options/analytics/:symbol" component={OptionsAnalyticsPage} />
      </MemoryRouter>
    </UIProvider>
  ));
}

async function expectThreeIdenticalAuthNotices() {
  await waitFor(() =>
    expect(screen.getAllByTestId(BROKER_AUTH_MESSAGE_TESTID)).toHaveLength(3),
  );
  const messages = screen
    .getAllByTestId(BROKER_AUTH_MESSAGE_TESTID)
    .map((el) => el.textContent);
  expect(new Set(messages).size).toBe(1);
  expect(messages[0]).toBe(BROKER_AUTH_MESSAGE);

  const actions = screen.getAllByRole("link", { name: BROKER_AUTH_ACTION });
  expect(actions).toHaveLength(3);
  expect(new Set(actions.map((el) => el.getAttribute("href"))).size).toBe(1);
  expect(actions[0]).toHaveAttribute("href", "/settings");

  // Existing per-surface connect testids stay intact.
  expect(screen.getByTestId("options-chain-connect")).toBeInTheDocument();
  expect(screen.getByTestId("analytics-reconnect")).toBeInTheDocument();
  expect(screen.getByTestId("positioning-connect")).toBeInTheDocument();
}

function authState() {
  vi.mocked(fetchChain).mockReset().mockRejectedValue(
    new OptionDockError("auth", "Reconnect Upstox in Settings", 401),
  );
  vi.mocked(getPositioning).mockReset().mockRejectedValue(
    new PositioningApiError("no token", 401),
  );
  h.setState({
    symbol: "NIFTY",
    status: "error",
    error: { kind: "auth", message: "Reconnect Upstox in Settings" },
    data: null,
    refreshing: false,
  });
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
  localStorage.clear();
  authState();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("broker auth copy — one message, one action across options surfaces", () => {
  it("(a) all three surfaces render the SAME 401 message and action label", async () => {
    renderThreeSurfaces();
    await expectThreeIdenticalAuthNotices();
  });

  it("(b) network/500 errors never render the reconnect state", async () => {
    vi.mocked(fetchChain).mockReset().mockRejectedValue(
      new OptionDockError("upstream", "Options service error", 500),
    );
    vi.mocked(getPositioning).mockReset().mockRejectedValue(
      new PositioningApiError("boom", 500),
    );
    h.setState({
      status: "error",
      error: { kind: "upstream", message: "Service unavailable" },
      data: null,
    });

    renderThreeSurfaces();

    await waitFor(() => expect(screen.getAllByRole("alert")).not.toHaveLength(0));
    expect(screen.queryAllByTestId(BROKER_AUTH_MESSAGE_TESTID)).toHaveLength(0);
    expect(screen.queryAllByRole("link", { name: BROKER_AUTH_ACTION })).toHaveLength(0);
    expect(screen.queryByTestId("options-chain-connect")).not.toBeInTheDocument();
    expect(screen.queryByTestId("analytics-reconnect")).not.toBeInTheDocument();
    expect(screen.queryByTestId("positioning-connect")).not.toBeInTheDocument();
  });

  it("(c) a 401 renders reconnect even when a token is believed present", async () => {
    // A valid-looking token in storage is what the Settings page would read to
    // claim "connected, expires in 11m". The panel must trust the typed 401.
    localStorage.setItem(
      "alphashri_token",
      "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature",
    );

    renderThreeSurfaces();
    await expectThreeIdenticalAuthNotices();
  });
});
