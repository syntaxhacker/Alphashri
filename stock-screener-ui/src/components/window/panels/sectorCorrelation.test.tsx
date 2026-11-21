// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createMemo, type Accessor } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { DockPanelContext } from "../../dock/types";
import { getPanelSpec, WINDOW_PANEL_TYPES } from "../panelRegistry";

// The registry defers this module; load it so hoisted mocks are ready on first mount.
await import("./sectorCorrelation");

const ctl = vi.hoisted(() => {
  const options: any[] = [];
  const chart = {
    setOption: (opt: any) => options.push(opt),
    resize: () => {},
    dispose: () => {},
  };
  return {
    fetchWithAuth: vi.fn(),
    options,
    chart,
    sibling: (id: string) => ({
      id,
      page: "sector" as const,
      title: id,
      size: 1,
      minWidth: 100,
      singleton: false,
      requires: [],
      mount: () => null,
    }),
  };
});

// Sibling panels belong to other lanes; stub them so this suite exercises the
// real registry without loading their in-flight dependencies.
vi.mock("./marketHeatmap", () => ({ MARKET_HEATMAP_PANEL: ctl.sibling("market.heatmap") }));
vi.mock("./newsFeed", () => ({ NEWS_FEED_PANEL: ctl.sibling("news.feed") }));
vi.mock("./optionsChain", () => ({ OPTIONS_CHAIN_PANEL: ctl.sibling("options.chain") }));
vi.mock("./paperPositions", () => ({ PAPER_POSITIONS_PANEL: ctl.sibling("paper.positions") }));
vi.mock("./sectorHeatmap", () => ({ SECTOR_HEATMAP_PANEL: ctl.sibling("sector.heatmap") }));

// Keep the real client/store path: the assertion is on the URL the client builds.
vi.mock("@/state/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/state/auth")>();
  return { ...actual, fetchWithAuth: (...args: unknown[]) => ctl.fetchWithAuth(...args) };
});

// ECharts paints to a canvas. Capture the real option objects instead so a
// matrix cell / sector label can be asserted without re-testing ECharts itself.
vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: async () => ({ init: () => ctl.chart }),
}));

const RESPONSE = {
  sectors: [
    {
      name: "IT",
      beta_vs_index: 1.12,
      relative_strength_5d: 1.5,
      relative_strength_1m: 2.1,
      relative_strength_3m: 3.2,
      rank_current: 1,
      rank_change_1m: 2,
    },
    {
      name: "Banks",
      beta_vs_index: 0.87,
      relative_strength_5d: -0.4,
      relative_strength_1m: -1.2,
      relative_strength_3m: 0.3,
      rank_current: 2,
      rank_change_1m: -1,
    },
  ],
  correlation_matrix: [
    [1, 0.82],
    [0.82, 1],
  ],
  sector_names: ["IT", "Banks"],
  last_updated: "2026-11-19T10:00:00Z",
};

const okResponse = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
const CTX: Accessor<DockPanelContext> = () => ({ market: "india" });

function MountSpec() {
  const spec = getPanelSpec("sector.correlation");
  const data = createMemo(() => spec?.data?.(CTX));
  return (
    <>
      {spec ? spec.mount(CTX, { data, commands: spec.commands ?? {} }) : <div data-testid="missing-spec" />}
    </>
  );
}

function renderPanel() {
  return render(() => (
    <UIProvider>
      <MountSpec />
    </UIProvider>
  ));
}

async function resetCorrelationStore() {
  const mod = await import("@/state/sectorCorrelation");
  mod.setMarket("india");
  mod.setLookbackDays(90);
  mod.setCorrelationData(null as any);
  mod.setIsLoading(false);
  mod.setError(null);
}

beforeEach(async () => {
  vi.clearAllMocks();
  ctl.options.length = 0;
  ctl.fetchWithAuth.mockResolvedValue(okResponse(RESPONSE));
  await resetCorrelationStore();
});

afterEach(async () => {
  cleanup();
  await resetCorrelationStore();
});

describe("sector.correlation HOME desk panel", () => {
  it("registers a picker/window spec with no required context", () => {
    expect(WINDOW_PANEL_TYPES.has("sector.correlation")).toBe(true);
    expect(getPanelSpec("sector.correlation")?.requires).toEqual([]);
  });

  it("(a) renders the real matrix content, not just a shell", async () => {
    renderPanel();

    await waitFor(() =>
      expect(ctl.options.some((o: any) => o.series?.[0]?.type === "heatmap")).toBe(true),
    );
    const heatmap = ctl.options.find((o: any) => o.series?.[0]?.type === "heatmap");
    expect(heatmap.xAxis.data).toEqual(["IT", "Banks"]);
    expect(heatmap.series[0].data).toContainEqual({
      value: [1, 0, 0.82],
      label: expect.anything(),
    });
    expect(screen.getByTestId("window-sector-correlation-beta")).toHaveTextContent("NIFTY 50");
    expect(ctl.fetchWithAuth).toHaveBeenCalledTimes(1);
  });

  it("(b) changing lookback refetches once with the new URL param", async () => {
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId("window-sector-correlation-heatmap")).toBeInTheDocument(),
    );
    expect(ctl.fetchWithAuth).toHaveBeenCalledTimes(1);
    expect(ctl.fetchWithAuth.mock.calls[0][0]).toContain("lookback_days=90");

    const lookback = screen.getByTestId("window-sector-correlation-lookback").querySelector("select")!;
    fireEvent.input(lookback, { target: { value: "30" } });

    await waitFor(() => expect(ctl.fetchWithAuth).toHaveBeenCalledTimes(2));
    expect(ctl.fetchWithAuth.mock.calls[1][0]).toContain("lookback_days=30");
    expect(ctl.fetchWithAuth.mock.calls[1][0]).toContain("market=india");
  });

  it("(c) loading renders a defined state, never a blank box", () => {
    let resolveLoad: ((value: Response) => void) | undefined;
    ctl.fetchWithAuth.mockImplementationOnce(
      () => new Promise((resolve) => { resolveLoad = resolve; }),
    );

    renderPanel();

    expect(screen.getByTestId("window-sector-correlation-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("window-sector-correlation-heatmap")).not.toBeInTheDocument();
    resolveLoad?.(okResponse(RESPONSE));
  });

  it("(d) empty data renders the empty state", async () => {
    ctl.fetchWithAuth.mockResolvedValueOnce(
      okResponse({ ...RESPONSE, sectors: [], sector_names: [], correlation_matrix: [] }),
    );

    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("window-sector-correlation-empty")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("window-sector-correlation-heatmap")).not.toBeInTheDocument();
  });

  it("(empty-action) the empty state offers an enabled Retry button", async () => {
    ctl.fetchWithAuth.mockResolvedValueOnce(
      okResponse({ ...RESPONSE, sectors: [], sector_names: [], correlation_matrix: [] }),
    );

    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("window-sector-correlation-empty")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("window-sector-correlation-empty-retry")).toBeEnabled();
  });

  it("(e) a fetch failure renders its message", async () => {
    ctl.fetchWithAuth.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ detail: "correlation feed exploded" }),
    } as Response);

    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("window-sector-correlation-error")).toHaveTextContent(
        "correlation feed exploded",
      ),
    );
    expect(screen.queryByTestId("window-sector-correlation-heatmap")).not.toBeInTheDocument();
  });

  it("(f) two open panels share one fetch — no double-fetch storm", async () => {
    render(() => (
      <UIProvider>
        <MountSpec />
        <MountSpec />
      </UIProvider>
    ));

    await waitFor(() =>
      expect(screen.getAllByTestId("window-sector-correlation-heatmap")).toHaveLength(2),
    );
    expect(ctl.fetchWithAuth).toHaveBeenCalledTimes(1);
  });

  it("(g) changing market refetches once and switches the benchmark", async () => {
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId("window-sector-correlation-heatmap")).toBeInTheDocument(),
    );

    const market = screen.getByTestId("window-sector-correlation-market").querySelector("select")!;
    fireEvent.input(market, { target: { value: "america" } });

    await waitFor(() => expect(ctl.fetchWithAuth).toHaveBeenCalledTimes(2));
    expect(ctl.fetchWithAuth.mock.calls[1][0]).toContain("market=america");
    await waitFor(() =>
      expect(screen.getByTestId("window-sector-correlation-beta")).toHaveTextContent("SPY"),
    );
  });
});
