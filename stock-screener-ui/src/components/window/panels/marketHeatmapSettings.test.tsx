// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createMemo, type Accessor } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { DockPanelContext } from "../../dock/types";
import type { MarketRow } from "../../../types/marketScreener";
import { getPanelSpec } from "../panelRegistry";
import {
  parseHeatmapSettings,
  serializeHeatmapSettings,
  type PersistedHeatmapSettings,
} from "./marketHeatmap";

const ctl = vi.hoisted(() => ({ rows: [] as MarketRow[] }));

vi.mock("./marketSnapshotHub", () => ({
  acquireMarketSnapshot: () => ({
    refs: 1,
    dispose: () => {},
    hook: {
      rows: () => ctl.rows,
      snapshot: () => null,
      total: () => ctl.rows.length,
      updateMode: () => null,
      asOf: () => null,
      isLoading: () => false,
      error: () => null,
      refresh: () => {},
      lastUpdated: () => null,
      stale: () => false,
      ageSec: () => null,
      warming: () => false,
    },
  }),
  releaseMarketSnapshot: () => {},
}));

vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: async () => ({
    init: () => ({
      setOption: () => {},
      on: () => {},
      resize: () => {},
      dispose: () => {},
    }),
  }),
}));

vi.mock("../../common/symbolDockContext", () => ({
  useSymbolDock: () => ({
    open: () => {},
    preview: () => {},
    endPreview: () => {},
    close: () => {},
    pinned: false,
    setOutlet: () => {},
  }),
}));

const CTX: Accessor<DockPanelContext> = () => ({ market: "india" });

function MountSpec(props: {
  settings?: Record<string, unknown>;
  onChange?: (patch: Record<string, unknown>) => void;
}) {
  const spec = getPanelSpec("market.heatmap");
  if (!spec) return <div data-testid="missing-spec" />;
  const data = createMemo(() => spec.data?.(CTX));
  return (
    <>
      {spec.mount(CTX, {
        data,
        commands: spec.commands ?? {},
        settings: () => props.settings ?? {},
        onSettingsChange: props.onChange,
      })}
    </>
  );
}

const mountWith = (settings?: Record<string, unknown>, onChange?: (p: Record<string, unknown>) => void) =>
  render(() => (
    <UIProvider>
      <MountSpec settings={settings} onChange={onChange} />
    </UIProvider>
  ));

const universeSelect = () =>
  screen.getByTestId("market-heatmap-universe").querySelector("select") as HTMLSelectElement;
const sizeSelect = () =>
  screen.getByTestId("market-heatmap-metric").querySelector("select") as HTMLSelectElement;

const row = (symbol: string, change: number): MarketRow => ({
  symbol,
  name: symbol,
  sector: "Energy",
  exchange: "NSE",
  close: 100,
  change,
  relativeVolume: 1,
  marketCapCr: 100_000,
  capTier: "large",
  rsi: 55,
  adx: 20,
  sma20: null,
  sma50: null,
  sma200: null,
  perfW: null,
  perf1m: null,
  high52w: null,
  low52w: null,
  pos52w: null,
  peRatio: null,
  pbRatio: null,
  dividendYield: null,
  roe: null,
  psRatio: null,
  fcfYield: null,
  revenue: null,
  netIncome: null,
  debtToEquity: null,
  currentRatio: null,
  grossMargin: null,
  operatingMargin: null,
  revYoy: null,
  epsYoy: null,
  volume: null,
  avgVolume: null,
  gap: null,
  atr: null,
  high: null,
  low: null,
  valueTraded: null,
  to52wHighPct: null,
  from52wLowPct: null,
  rangeVsAtr: null,
  fno: false,
  etf: false,
});

const withFilters = {
  search: "",
  capTiers: ["large"],
  priceMin: null,
  priceMax: null,
  dayChangeMin: 1,
  dayChangeMax: null,
  mcapMinCr: null,
  mcapMaxCr: null,
  rsiMin: null,
  rsiMax: null,
  relVolMin: null,
  relVolMax: null,
  aboveSma20: false,
  aboveSma50: false,
  aboveSma200: false,
  fnoOnly: false,
  sectors: ["Energy"],
  sort: "mcap_desc",
};

beforeEach(() => {
  ctl.rows = [row("RELIANCE", 1)];
});

afterEach(() => cleanup());

describe("market.heatmap — persisted panel settings", () => {
  it("(d) sizeBy and universe survive a remount with the stored bag", async () => {
    const stored = { universe: "nifty50", sizeBy: "rsi", filters: withFilters };
    mountWith(stored);

    await waitFor(() => expect(screen.getByTestId("market-heatmap-panel")).toBeInTheDocument());
    expect(universeSelect().value).toBe("nifty50");
    expect(sizeSelect().value).toBe("rsi");
    // cap tier + day min + sector = three active filters from the stored bag.
    expect(screen.getByTestId("heatmap-filters-button")).toHaveAttribute("aria-label", "Filters (3)");

    cleanup();
    mountWith(stored);
    await waitFor(() => expect(screen.getByTestId("market-heatmap-panel")).toBeInTheDocument());
    expect(universeSelect().value).toBe("nifty50");
    expect(sizeSelect().value).toBe("rsi");
    expect(screen.getByTestId("heatmap-filters-button")).toHaveAttribute("aria-label", "Filters (3)");
  });

  it("a metric change reports one patch upward through the settings channel", async () => {
    const onChange = vi.fn();
    mountWith(undefined, onChange);

    await waitFor(() => expect(screen.getByTestId("market-heatmap-panel")).toBeInTheDocument());
    fireEvent.input(sizeSelect(), { target: { value: "rsi" } });

    expect(onChange).toHaveBeenCalledWith({ sizeBy: "rsi" });
  });

  it("parses only valid keys and strips unknown ones (e.g. a removed colorBy)", () => {
    const parsed = parseHeatmapSettings({
      universe: "nifty50",
      sizeBy: "rsi",
      colorBy: "pe_ratio",
      filters: { ...withFilters, capTiers: ["large", 7], dayChangeMin: Number.NaN },
    });
    expect(parsed.universe).toBe("nifty50");
    expect(parsed.sizeBy).toBe("rsi");
    expect("colorBy" in parsed).toBe(false);
    expect(parsed.filters?.capTiers).toEqual(new Set(["large"]));
    expect(parsed.filters?.dayChangeMin).toBeNull();

    expect(parseHeatmapSettings("bad")).toEqual({});
  });

  it("serializes a Set-backed filter into a JSON-safe bag", () => {
    const settings: PersistedHeatmapSettings = parseHeatmapSettings({
      universe: "nifty50",
      sizeBy: "change_pct",
      filters: withFilters,
    });
    const wire = serializeHeatmapSettings({
      universe: "nifty50",
      sizeBy: "change_pct",
      filters: settings.filters!,
    });
    expect(JSON.stringify(wire)).not.toContain("{}");
    expect(Array.isArray((wire.filters as { capTiers: unknown }).capTiers)).toBe(true);
    expect(parseHeatmapSettings(wire).filters?.capTiers).toEqual(new Set(["large"]));
  });
});
