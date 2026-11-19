// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createMemo, type Accessor } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import {
  BROKER_AUTH_ACTION,
  BROKER_AUTH_MESSAGE,
} from "@/components/common/BrokerAuthNotice";
import { fetchNiftyExpiries, fetchOptionsExpiries } from "@/api/reportNifty";
import type { DockPanelContext } from "../../dock/types";
import { WindowManager } from "../WindowManager";
import { WINDOW_PANELS } from "../panelRegistry";
import { HOME_PANELS } from "../../../pages/home/homePanels";
import { OPTIONS_POSITIONING_PANEL } from "./optionsPositioning";

vi.mock("@/api/reportNifty", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/reportNifty")>();
  return {
    ...actual,
    fetchNiftyExpiries: vi.fn(),
    fetchOptionsExpiries: vi.fn(),
  };
});

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
const expiriesFixture = () => [{ date: nearExpiry() }, { date: farExpiry() }];

const fetchMock = vi.fn();

vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({
    init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), on: vi.fn() }),
  })),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fixture = () => ({
  status: "ok",
  underlying: "NIFTY",
  expiry: "2026-11-26",
  spot: 24000,
  lot_size: 25,
  timestamp: "2026-11-26T10:00:00+05:30",
  baseline: "prev_close_oi",
  baseline_note: "note",
  verdict: "bearish",
  initiated_cr: -1000,
  lean_pct: 60,
  state: { calls_cr: 100, puts_cr: -200, note: "note" },
  flow: { calls_cr: 1, puts_cr: 2, note: "note" },
  initiated: { bearish_cr: 1, bullish_cr: 2, note: "note" },
  split: { bearish_cr: 1, bearish_pct: 60, bullish_cr: 2, bullish_pct: 40 },
  read: { pct: 90, readable_shares: 100, total_shares: 110 },
  biggest_move: {
    strike: 24000,
    side: "CE",
    sentiment: "Short Buildup",
    label: "call writers opened",
    cr: -500,
  },
  rows: [
    {
      strike: 24000,
      ce_class: "Short Buildup",
      ce_doi_shares: 1000,
      ce_cr: 100,
      pe_class: "Long Buildup",
      pe_doi_shares: 500,
      pe_cr: 50,
      net_cr: 150,
    },
  ],
});

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
            {
              id: "positioning",
              type: "options.positioning",
              title: "OPTIONS POSITIONING",
              x: 0,
              y: 0,
              w: 900,
              h: 520,
              z: 1,
            },
          ],
        }}
        context={context}
        onLayoutChange={() => {}}
        canvas={{ w: 1280, h: 800 }}
        specs={[OPTIONS_POSITIONING_PANEL]}
        lockedInitially
      />
    </UIProvider>
  ));
}

const urls = () =>
  fetchMock.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.includes("/api/options/positioning/"));

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
  fetchMock.mockReset();
  fetchNiftyExpiriesMock.mockReset();
  fetchOptionsExpiriesMock.mockReset();
  fetchNiftyExpiriesMock.mockImplementation(async () => expiriesFixture());
  fetchOptionsExpiriesMock.mockImplementation(async () => [nearExpiry(), farExpiry()]);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("options.positioning window panel — owned fetch stays in PositioningPanel", () => {
  it("(a) renders the panel with the context underlying+expiry", async () => {
    fetchMock.mockResolvedValue(jsonResponse(fixture()));
    renderWindow();

    expect(await screen.findByTestId("positioning-verdict")).toBeInTheDocument();
    expect(screen.getByTestId("positioning-strike-row-24000")).toBeInTheDocument();
    expect(urls()[0]).toContain("/api/options/positioning/NIFTY?");
    expect(urls()[0]).toContain("expiry=2026-11-26");
  });

  it("(b) changing the in-window expiry refetches with the new URL", async () => {
    fetchMock.mockResolvedValue(jsonResponse(fixture()));
    renderWindow();
    expect(await screen.findByTestId("positioning-verdict")).toBeInTheDocument();

    const expiryInput = screen.getByTestId("options-positioning-expiry-input");
    fireEvent.input(within(expiryInput).getByRole("combobox"), {
      target: { value: farExpiry() },
    });

    await waitFor(() => expect(urls().some((u) => u.includes(`expiry=${farExpiry()}`))).toBe(true));
    expect(urls().at(-1)).toContain("/api/options/positioning/NIFTY?");
    expect(urls().at(-1)).toContain("mode=since_open");
  });

  it("(c) no listed expiries renders the component's empty state without fetching or crashing", async () => {
    fetchNiftyExpiriesMock.mockResolvedValue([]);
    renderWindow({ expiry: undefined });

    expect(await screen.findByTestId("options-positioning-expiry-empty")).toBeInTheDocument();
    expect(screen.getByTestId("options-positioning-empty")).toBeInTheDocument();
    expect(screen.getByTestId("positioning-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("positioning-error")).not.toBeInTheDocument();
    expect(urls()).toHaveLength(0);
  });

  it("(empty-action) the empty state's expiry field is present with an honest hint", async () => {
    fetchNiftyExpiriesMock.mockResolvedValue([]);
    renderWindow({ expiry: undefined });

    expect(await screen.findByTestId("options-positioning-expiry-empty")).toBeInTheDocument();
    expect(screen.getByTestId("options-positioning-expiry-input")).toBeInTheDocument();
  });

  it("(d) a 401 renders a distinguishable Upstox-connection state", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "unauthorized" }, 401));
    renderWindow();

    expect(await screen.findByTestId("positioning-error")).toBeInTheDocument();
    expect(screen.getByTestId("positioning-error")).toHaveTextContent(BROKER_AUTH_MESSAGE);
    expect(screen.getByTestId("positioning-connect")).toHaveTextContent(BROKER_AUTH_ACTION);
    expect(screen.queryByTestId("positioning-verdict")).not.toBeInTheDocument();
  });
});

function DirectPositioning(props: { ctx: Accessor<DockPanelContext> }) {
  const data = createMemo(() => OPTIONS_POSITIONING_PANEL.data?.(props.ctx));
  return <>{OPTIONS_POSITIONING_PANEL.mount(props.ctx, { data, commands: {} })}</>;
}

function mountTwoPositioning(contexts: DockPanelContext[]) {
  return render(() => (
    <UIProvider>
      {contexts.map((context) => (
        <DirectPositioning ctx={() => context} />
      ))}
    </UIProvider>
  ));
}

describe("options.positioning — two-window request count", () => {
  it("same underlying+expiry: two windows join one positioning fetch", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(fixture())));
    mountTwoPositioning([
      { symbol: "NIFTY", expiry: "2026-11-26" },
      { symbol: "NIFTY", expiry: "2026-11-26" },
    ]);

    await waitFor(() =>
      expect(screen.getAllByTestId("positioning-verdict")).toHaveLength(2),
    );
    expect(urls()).toHaveLength(1);
  });

  it("different expiry: two windows fetch two positionings", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(fixture())));
    mountTwoPositioning([
      { symbol: "NIFTY", expiry: "2026-11-26" },
      { symbol: "NIFTY", expiry: "2026-12-04" },
    ]);

    await waitFor(() =>
      expect(screen.getAllByTestId("positioning-verdict")).toHaveLength(2),
    );
    expect(urls()).toHaveLength(2);
    expect(urls().some((u) => u.includes("expiry=2026-11-26"))).toBe(true);
    expect(urls().some((u) => u.includes("expiry=2026-12-04"))).toBe(true);
  });
});

describe("options.positioning window panel — in-window controls and registration", () => {
  it("(e) underlying and expiry controls live inside the window, not the page toolbar", () => {
    renderWindow({ expiry: undefined });
    const body = screen.getByTestId("window-body-positioning");

    expect(within(body).getByTestId("options-positioning-underlying-input")).toBeInTheDocument();
    expect(within(body).getByTestId("options-positioning-expiry-input")).toBeInTheDocument();
    expect(screen.queryByTestId("home-expiry-input")).not.toBeInTheDocument();
  });

  it("(f) the panel is registered in the window registry and the home picker", () => {
    expect(WINDOW_PANELS.map((spec) => spec.id)).toContain("options.positioning");
    expect(HOME_PANELS.map((spec) => spec.id)).toContain("options.positioning");
  });
});

describe("options.positioning — expiry picker", () => {
  it("(a) the select is populated from listings and defaults to nearest", async () => {
    fetchMock.mockResolvedValue(jsonResponse(fixture()));
    renderWindow({ expiry: undefined });
    const picker = await screen.findByTestId("options-positioning-expiry-picker");
    await waitFor(() =>
      expect(within(picker).getAllByRole("option")).toHaveLength(2),
    );
    expect(within(picker).getByRole("combobox")).toHaveValue(nearExpiry());
    expect(fetchNiftyExpiriesMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(urls().some((u) => u.includes(`expiry=${nearExpiry()}`))).toBe(true));
  });

  it("(e) a context expiry is honoured over the nearest default", async () => {
    fetchMock.mockResolvedValue(jsonResponse(fixture()));
    renderWindow({ expiry: farExpiry() });
    const picker = await screen.findByTestId("options-positioning-expiry-picker");
    await waitFor(() => expect(within(picker).getAllByRole("option")).toHaveLength(2));
    expect(within(picker).getByRole("combobox")).toHaveValue(farExpiry());
    expect(urls().some((u) => u.includes(`expiry=${farExpiry()}`))).toBe(true);
  });
});
