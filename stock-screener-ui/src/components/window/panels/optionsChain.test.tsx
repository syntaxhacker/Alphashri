// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createMemo, type Accessor } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import {
  OptionDockError,
  fetchChain,
  type ChainLeg,
  type ChainRow,
  type OptionDockChain,
} from "@/api/optionsDock";
import type { DockPanelContext } from "../../dock/types";
import { WindowManager } from "../WindowManager";
import { WINDOW_PANELS } from "../panelRegistry";
import { HOME_PANELS } from "../../../pages/home/homePanels";
import { OPTIONS_CHAIN_PANEL } from "./optionsChain";

vi.mock("@/api/optionsDock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/optionsDock")>();
  return { ...actual, fetchChain: vi.fn() };
});

const fetchChainMock = vi.mocked(fetchChain);

function leg(ltp: number): ChainLeg {
  return {
    ltp,
    oi: 1000,
    prevOi: 0,
    volume: 10,
    iv: 14,
    delta: 0.5,
    gamma: 0,
    theta: 0,
    vega: 0,
    pop: null,
    bid: null,
    ask: null,
    instrumentKey: "NSE_FO|TEST",
  };
}

function makeChain(rows: ChainRow[]): OptionDockChain {
  return {
    expiry: "2026-11-26",
    spot: 24000,
    pcr: 1,
    atmIv: 14,
    spotChangePct: 0.2,
    rows,
    asOf: "2026-11-26T10:00:00Z",
    levels: null,
  };
}

const fixture = () =>
  makeChain([
    { strike: 23900, ce: leg(180.5), pe: leg(20.1) },
    { strike: 24000, ce: leg(95.2), pe: leg(60.4) },
    { strike: 24100, ce: leg(40.3), pe: leg(130.7) },
  ]);

function renderWindow(overrides: Partial<DockPanelContext> = {}) {
  const context = (): DockPanelContext => ({
    symbol: "NIFTY",
    market: "india",
    timeframe: "1m",
    expiry: "2026-11-26",
    ...overrides,
  });
  return render(() => (
    <UIProvider>
      <WindowManager
        layout={{
          name: "Main",
          windows: [
            { id: "chain", type: "options.chain", title: "OPTIONS CHAIN", x: 0, y: 0, w: 900, h: 520, z: 1 },
          ],
        }}
        context={context}
        onLayoutChange={() => {}}
        canvas={{ w: 1280, h: 800 }}
        specs={[OPTIONS_CHAIN_PANEL]}
        lockedInitially
      />
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
  fetchChainMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("options.chain window panel — real chain data", () => {
  it("(a) renders a strike and a premium cell from the fetched chain", async () => {
    fetchChainMock.mockResolvedValue(fixture());
    renderWindow();

    await waitFor(() =>
      expect(screen.getByTestId("options-strike-cell-24000")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("options-ce-24000")).toHaveTextContent("95.2");
    expect(screen.getByTestId("options-pe-24000")).toHaveTextContent("60.4");
    expect(fetchChainMock).toHaveBeenCalledWith(
      "NIFTY",
      "2026-11-26",
      expect.any(AbortSignal),
    );
  });

  it("(b) loading is a distinct defined state", () => {
    fetchChainMock.mockImplementation(() => new Promise(() => {}));
    renderWindow();

    expect(screen.getByTestId("options-chain-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("options-chain-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("options-chain-error")).not.toBeInTheDocument();
  });

  it("(b) empty is a distinct defined state", async () => {
    fetchChainMock.mockResolvedValue(makeChain([]));
    renderWindow();

    await waitFor(() =>
      expect(screen.getByTestId("options-chain-empty")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("options-chain-loading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("options-chain-error")).not.toBeInTheDocument();
    expect(screen.queryByTestId("options-chain-table")).not.toBeInTheDocument();
  });

  it("(b) a 401 surfaces the typed auth state, not a blank box", async () => {
    fetchChainMock.mockRejectedValue(
      new OptionDockError("auth", "Reconnect Upstox in Settings", 401),
    );
    renderWindow();

    await waitFor(() =>
      expect(screen.getByTestId("options-chain-error")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("options-chain-error")).toHaveAttribute("data-kind", "auth");
    expect(screen.getByTestId("options-chain-error")).toHaveTextContent(
      "Reconnect Upstox in Settings",
    );
    expect(screen.queryByTestId("options-chain-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("options-chain-table")).not.toBeInTheDocument();
  });

  it("(b) a 429 surfaces a distinct rate-limited state", async () => {
    fetchChainMock.mockRejectedValue(
      new OptionDockError("rate_limited", "Rate limited", 429, 8000),
    );
    renderWindow();

    await waitFor(() =>
      expect(screen.getByTestId("options-chain-error")).toBeInTheDocument(),
    );
    const error = screen.getByTestId("options-chain-error");
    expect(error).toHaveAttribute("data-kind", "rate_limited");
    expect(error).toHaveTextContent("Rate limited");
    expect(error).not.toHaveAttribute("data-kind", "auth");
  });
});

function DirectChain(props: { ctx: Accessor<DockPanelContext> }) {
  const data = createMemo(() => OPTIONS_CHAIN_PANEL.data?.(props.ctx));
  return <>{OPTIONS_CHAIN_PANEL.mount(props.ctx, { data, commands: {} })}</>;
}

function mountTwoChains(contexts: DockPanelContext[]) {
  return render(() => (
    <UIProvider>
      {contexts.map((context) => (
        <DirectChain ctx={() => context} />
      ))}
    </UIProvider>
  ));
}

describe("options.chain failure behaviour", () => {
  it("(a) a 500 renders the error state, not the empty state", async () => {
    fetchChainMock.mockRejectedValue(
      new OptionDockError("upstream", "Options service error", 500),
    );
    renderWindow();

    const error = await screen.findByTestId("options-chain-error");
    expect(error).toHaveAttribute("data-kind", "upstream");
    expect(error).toHaveTextContent("Options service error");
    expect(screen.queryByTestId("options-chain-empty")).not.toBeInTheDocument();
  });

  it("(c) an aborted superseded request renders no error flash", async () => {
    let rejectFirst!: (reason: unknown) => void;
    fetchChainMock.mockImplementationOnce(
      () => new Promise((_resolve, reject) => { rejectFirst = reject; }),
    );
    fetchChainMock.mockImplementation(async () => fixture());
    renderWindow();

    expect(screen.getByTestId("options-chain-loading")).toBeInTheDocument();
    fireEvent.input(screen.getByTestId("options-chain-expiry-input"), {
      target: { value: "2026-12-04" },
    });
    rejectFirst(new DOMException("Aborted", "AbortError"));

    await waitFor(() =>
      expect(screen.getByTestId("options-strike-cell-24000")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("options-chain-error")).not.toBeInTheDocument();
  });

  it("(d) a 401 offers the broker-connect action", async () => {
    fetchChainMock.mockRejectedValue(
      new OptionDockError("auth", "Reconnect Upstox in Settings", 401),
    );
    renderWindow();

    const connect = await screen.findByTestId("options-chain-connect");
    expect(connect).toHaveTextContent("Connect broker in Settings");
    expect(connect).toHaveAttribute("href", "/settings");
    expect(screen.getByTestId("options-chain-error")).toHaveAttribute("data-kind", "auth");
  });

  it("(e) a 429 shows the wait and disables immediate retry", async () => {
    fetchChainMock.mockRejectedValue(
      new OptionDockError("rate_limited", "Rate limited", 429, 8000),
    );
    renderWindow();

    const error = await screen.findByTestId("options-chain-error");
    expect(error).toHaveAttribute("data-kind", "rate_limited");
    expect(error).toHaveTextContent("retry in 8s");
    const retry = within(error).getByRole("button", { name: /retry/i });
    expect(retry).toBeDisabled();
    expect(retry).toHaveTextContent("Retry in 8s");
  });
});

describe("options.chain — two-window request count", () => {
  it("same symbol+expiry: two windows join one chain fetch", async () => {
    fetchChainMock.mockResolvedValue(fixture());
    mountTwoChains([
      { symbol: "NIFTY", expiry: "2026-11-26" },
      { symbol: "NIFTY", expiry: "2026-11-26" },
    ]);

    await waitFor(() =>
      expect(screen.getAllByTestId("options-strike-cell-24000")).toHaveLength(2),
    );
    expect(fetchChainMock).toHaveBeenCalledTimes(1);
  });

  it("different expiry: two windows fetch two chains", async () => {
    fetchChainMock.mockResolvedValue(fixture());
    mountTwoChains([
      { symbol: "NIFTY", expiry: "2026-11-26" },
      { symbol: "NIFTY", expiry: "2026-12-04" },
    ]);

    await waitFor(() =>
      expect(screen.getAllByTestId("options-strike-cell-24000")).toHaveLength(2),
    );
    expect(fetchChainMock).toHaveBeenCalledTimes(2);
    expect(fetchChainMock.mock.calls.map((c) => c[1]).sort()).toEqual([
      "2026-11-26",
      "2026-12-04",
    ]);
  });
});

describe("options.chain window panel — in-window control", () => {
  it("(c) the expiry control lives inside the window, not the page toolbar", async () => {
    // No context expiry: any control must come from the window itself.
    renderWindow({ expiry: undefined });
    const body = screen.getByTestId("window-body-chain");
    const expiryInput = within(body).getByTestId("options-chain-expiry-input");

    expect(body).toContainElement(expiryInput);
    expect(screen.queryByTestId("home-expiry-input")).not.toBeInTheDocument();
    expect(screen.getByTestId("options-chain-empty")).toBeInTheDocument();
    expect(fetchChainMock).not.toHaveBeenCalled();

    fetchChainMock.mockResolvedValue(fixture());
    fireEvent.input(expiryInput, { target: { value: "2026-12-04" } });
    await waitFor(() =>
      expect(fetchChainMock).toHaveBeenCalledWith(
        "NIFTY",
        "2026-12-04",
        expect.any(AbortSignal),
      ),
    );
  });

  it("(c) the panel is registered in the window picker and the window registry", () => {
    expect(WINDOW_PANELS.map((spec) => spec.id)).toContain("options.chain");
    expect(HOME_PANELS.map((spec) => spec.id)).toContain("options.chain");
  });
});
