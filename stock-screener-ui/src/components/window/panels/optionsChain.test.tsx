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
import { fetchNiftyExpiries, fetchOptionsExpiries } from "@/api/reportNifty";
import type { DockPanelContext } from "../../dock/types";
import { WindowManager } from "../WindowManager";
import { WINDOW_PANELS } from "../panelRegistry";
import { HOME_PANELS } from "../../../pages/home/homePanels";
import { OPTIONS_CHAIN_PANEL } from "./optionsChain";

vi.mock("@/api/optionsDock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/optionsDock")>();
  return { ...actual, fetchChain: vi.fn() };
});

vi.mock("@/api/reportNifty", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/reportNifty")>();
  return {
    ...actual,
    fetchNiftyExpiries: vi.fn(),
    fetchOptionsExpiries: vi.fn(),
  };
});

const fetchChainMock = vi.mocked(fetchChain);
const fetchNiftyExpiriesMock = vi.mocked(fetchNiftyExpiries);
const fetchOptionsExpiriesMock = vi.mocked(fetchOptionsExpiries);

/** Dates relative to today so "nearest" stays correct whenever CI runs. */
const isoAfter = (days: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const nearExpiry = () => isoAfter(3);
const farExpiry = () => isoAfter(21);
const expiriesFixture = () => [
  { date: nearExpiry() },
  { date: farExpiry() },
];

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
  fetchNiftyExpiriesMock.mockReset();
  fetchOptionsExpiriesMock.mockReset();
  fetchNiftyExpiriesMock.mockImplementation(async () => expiriesFixture());
  fetchOptionsExpiriesMock.mockImplementation(async () => [
    nearExpiry(),
    farExpiry(),
  ]);
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

  it("(empty-action) the empty state offers an enabled Retry button", async () => {
    fetchChainMock.mockResolvedValue(makeChain([]));
    renderWindow();

    await waitFor(() => expect(screen.getByTestId("options-chain-empty")).toBeInTheDocument());
    expect(screen.getByTestId("options-chain-empty-retry")).toBeEnabled();
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
    await waitFor(() =>
      expect(
        within(screen.getByTestId("options-chain-expiry-input")).getByRole("combobox"),
      ).toBeEnabled(),
    );
    const expirySelect = within(screen.getByTestId("options-chain-expiry-input")).getByRole("combobox");
    fireEvent.input(expirySelect, { target: { value: farExpiry() } });
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
    fetchChainMock.mockResolvedValue(fixture());
    renderWindow();
    const body = screen.getByTestId("window-body-chain");
    const expiryInput = within(body).getByTestId("options-chain-expiry-input");

    expect(body).toContainElement(expiryInput);
    expect(screen.queryByTestId("home-expiry-input")).not.toBeInTheDocument();

    await waitFor(() =>
      expect(
        within(screen.getByTestId("options-chain-expiry-input")).getByRole("combobox"),
      ).toBeEnabled(),
    );
    const expirySelect = within(screen.getByTestId("options-chain-expiry-input")).getByRole("combobox");
    fireEvent.input(expirySelect, { target: { value: farExpiry() } });
    await waitFor(() =>
      expect(fetchChainMock).toHaveBeenCalledWith(
        "NIFTY",
        farExpiry(),
        expect.any(AbortSignal),
      ),
    );
  });

  it("(c) the panel is registered in the window picker and the window registry", () => {
    expect(WINDOW_PANELS.map((spec) => spec.id)).toContain("options.chain");
    expect(HOME_PANELS.map((spec) => spec.id)).toContain("options.chain");
  });
});

describe("options.chain — expiry picker", () => {
  it("(a) the select is populated from real listings and defaults to the nearest expiry", async () => {
    fetchChainMock.mockResolvedValue(fixture());
    renderWindow({ expiry: undefined });

    const picker = await screen.findByTestId("options-chain-expiry-picker");
    await waitFor(() =>
      expect(within(picker).getAllByRole("option")).toHaveLength(2),
    );
    const select = within(picker).getByRole("combobox");
    expect(within(select).getAllByRole("option").map((o) => o.getAttribute("value"))).toEqual([
      nearExpiry(),
      farExpiry(),
    ]);
    expect(select).toHaveValue(nearExpiry());
    expect(fetchNiftyExpiriesMock).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(fetchChainMock).toHaveBeenCalledWith(
        "NIFTY",
        nearExpiry(),
        expect.any(AbortSignal),
      ),
    );
  });

  it("(b) choosing an expiry refetches the chain with that date", async () => {
    fetchChainMock.mockResolvedValue(fixture());
    renderWindow({ expiry: undefined });
    const picker = await screen.findByTestId("options-chain-expiry-picker");
    await waitFor(() => expect(within(picker).getAllByRole("option")).toHaveLength(2));

    fireEvent.input(within(picker).getByRole("combobox"), {
      target: { value: farExpiry() },
    });

    await waitFor(() =>
      expect(fetchChainMock).toHaveBeenCalledWith(
        "NIFTY",
        farExpiry(),
        expect.any(AbortSignal),
      ),
    );
  });

  it("(d) a failed expiries request renders an error with Retry, not an empty select", async () => {
    fetchChainMock.mockResolvedValue(fixture());
    fetchNiftyExpiriesMock
      .mockRejectedValueOnce(new Error("expiry service down"))
      .mockImplementation(async () => expiriesFixture());
    renderWindow({ expiry: undefined });

    const error = await screen.findByTestId("options-chain-expiry-error");
    expect(error).toHaveTextContent(/expiry service down/i);
    const retry = within(error).getByRole("button", { name: /retry/i });
    expect(retry).toBeEnabled();
    expect(fetchChainMock).not.toHaveBeenCalled();

    fireEvent.click(retry);
    await waitFor(() => expect(fetchNiftyExpiriesMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByTestId("options-chain-expiry-error")).not.toBeInTheDocument(),
    );
    expect(within(screen.getByTestId("options-chain-expiry-picker")).getAllByRole("option")).toHaveLength(2);
  });

  it("(e) a context expiry is honoured and not overwritten by the default", async () => {
    fetchChainMock.mockResolvedValue(fixture());
    renderWindow({ expiry: farExpiry() });

    const picker = await screen.findByTestId("options-chain-expiry-picker");
    await waitFor(() => expect(within(picker).getAllByRole("option")).toHaveLength(2));
    expect(within(picker).getByRole("combobox")).toHaveValue(farExpiry());
    expect(fetchChainMock).toHaveBeenCalledWith(
      "NIFTY",
      farExpiry(),
      expect.any(AbortSignal),
    );
    expect(fetchChainMock).not.toHaveBeenCalledWith(
      "NIFTY",
      nearExpiry(),
      expect.any(AbortSignal),
    );
  });

  it("(f) no expiries for the symbol renders an explanatory state", async () => {
    fetchNiftyExpiriesMock.mockResolvedValue([]);
    renderWindow({ expiry: undefined });

    const empty = await screen.findByTestId("options-chain-expiry-empty");
    expect(empty).toHaveTextContent(/no expiries listed/i);
    expect(fetchChainMock).not.toHaveBeenCalled();
  });
});
