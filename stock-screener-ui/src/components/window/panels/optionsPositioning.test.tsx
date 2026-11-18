// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { DockPanelContext } from "../../dock/types";
import { WindowManager } from "../WindowManager";
import { WINDOW_PANELS } from "../panelRegistry";
import { HOME_PANELS } from "../../../pages/home/homePanels";
import { OPTIONS_POSITIONING_PANEL } from "./optionsPositioning";

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

const urls = () => fetchMock.mock.calls.map((call) => String(call[0]));

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
    fireEvent.input(expiryInput, { target: { value: "2026-12-04" } });

    await waitFor(() => expect(urls().some((u) => u.includes("expiry=2026-12-04"))).toBe(true));
    expect(urls().at(-1)).toContain("/api/options/positioning/NIFTY?");
    expect(urls().at(-1)).toContain("mode=since_open");
  });

  it("(c) no expiry renders the component's empty state without fetching or crashing", () => {
    renderWindow({ expiry: undefined });

    expect(screen.getByTestId("options-positioning-empty")).toBeInTheDocument();
    expect(screen.getByTestId("positioning-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("positioning-error")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("(d) a 401 renders a distinguishable Upstox-connection state", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "unauthorized" }, 401));
    renderWindow();

    expect(await screen.findByTestId("positioning-error")).toBeInTheDocument();
    expect(screen.getByTestId("positioning-error")).toHaveTextContent(
      "Upstox connection required to load positioning.",
    );
    expect(screen.getByTestId("positioning-connect")).toHaveTextContent(
      "Connect Upstox in Settings",
    );
    expect(screen.queryByTestId("positioning-verdict")).not.toBeInTheDocument();
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
