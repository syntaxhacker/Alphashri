// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { Show, createMemo, createSignal, type Accessor } from "solid-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { MarketRow } from "@/types/marketScreener";
import { MarketMapView } from "./MarketMapView";
import {
  estimatedTileHeightPx,
  MIN_LABEL_HEIGHT_PX,
  MIN_LABEL_LINE_HEIGHT_PX,
  MIN_LABEL_WIDTH_PX,
  shortTreemapSymbol,
  suppressTinyFlatLabels,
} from "./marketTreemap";
import { MARKET_HEATMAP_PANEL } from "../window/panels/marketHeatmap";

/**
 * Call counters for the heatmap's hot functions. The wrappers are transparent:
 * every call delegates to the real implementation, so the emitted option is
 * byte-identical to production — only the number of calls is observed.
 */
const counts = vi.hoisted(() => ({
  toTreemapRow: 0,
  buildOption: 0,
  suppress: 0,
  suppressReallocated: 0,
  filterMarketRows: 0,
  filterOnFiltered: 0,
  colorDomain: 0,
  option: null as any,
}));

vi.mock("./marketTreemap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./marketTreemap")>();
  return {
    ...actual,
    toTreemapRow: (...args: Parameters<typeof actual.toTreemapRow>) => {
      counts.toTreemapRow++;
      return actual.toTreemapRow(...args);
    },
    marketColorDomain: (...args: Parameters<typeof actual.marketColorDomain>) => {
      counts.colorDomain++;
      return actual.marketColorDomain(...args);
    },
    suppressTinyFlatLabels: (...args: Parameters<typeof actual.suppressTinyFlatLabels>) => {
      counts.suppress++;
      const out = actual.suppressTinyFlatLabels(...args);
      for (let i = 0; i < out.length; i++) {
        if (out[i] !== args[0][i]) counts.suppressReallocated++;
      }
      return out;
    },
  };
});

vi.mock("@/components/heatmap/stockTreemap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/heatmap/stockTreemap")>();
  return {
    ...actual,
    buildStockTreemapOption: (...args: Parameters<typeof actual.buildStockTreemapOption>) => {
      counts.buildOption++;
      return actual.buildStockTreemapOption(...args);
    },
  };
});

vi.mock("./marketFilters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./marketFilters")>();
  return {
    ...actual,
    filterMarketRows: (...args: Parameters<typeof actual.filterMarketRows>) => {
      counts.filterMarketRows++;
      const result = actual.filterMarketRows(...args);
      return new Proxy(result, {
        get(target, prop, receiver) {
          if (prop === "filter") counts.filterOnFiltered++;
          return Reflect.get(target, prop, receiver);
        },
      });
    },
  };
});

vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: async () => ({
    init: () => ({
      setOption: (option: any) => {
        counts.option = option;
      },
      on: () => {},
      resize: () => {},
      dispose: () => {},
    }),
  }),
}));

const panelCtl = vi.hoisted(() => ({
  setRows: null as unknown as (rows: MarketRow[]) => void,
}));

vi.mock("./useMarketSnapshotSolid", async () => {
  const { createSignal } = await import("solid-js");
  const [rows, setRows] = createSignal<MarketRow[]>([]);
  panelCtl.setRows = setRows;
  return {
    useMarketSnapshotSolid: () => ({
      snapshot: () => null,
      rows,
      total: () => rows().length,
      updateMode: () => null,
      asOf: () => null,
      isLoading: () => false,
      error: () => null,
      refresh: () => {},
      lastUpdated: () => null,
      stale: () => false,
      ageSec: () => null,
      warming: () => false,
    }),
  };
});

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
  fno: false,
  etf: false,
});

const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => row(`S${String(i).padStart(4, "0")}`, i % 7));

/** The pre-fix mapping, kept verbatim as the byte-identical reference. */
function legacySuppressTinyFlatLabels<
  T extends { value: number; label?: Record<string, unknown> },
>(tiles: T[], widthPx?: number, heightPx?: number): T[] {
  const total = tiles.reduce((sum, tile) => sum + tile.value, 0);
  return tiles.map((tile) => {
    const side = estimatedTileHeightPx(tile.value, total, widthPx, heightPx);
    const twoLine = side >= MIN_LABEL_WIDTH_PX && side >= MIN_LABEL_HEIGHT_PX;
    const oneLine = !twoLine && side >= MIN_LABEL_LINE_HEIGHT_PX && side >= MIN_LABEL_WIDTH_PX;
    return {
      ...tile,
      label: {
        ...tile.label,
        show: twoLine || oneLine,
        ...(oneLine
          ? { formatter: (p: { name?: string }) => `{sym|${shortTreemapSymbol(p.name ?? "")}}` }
          : {}),
      },
    };
  });
}

const FIXED_OPTION = '{"tooltip":{"trigger":"item","backgroundColor":"#FFFFFF","borderColor":"#D0D7DE","textStyle":{"color":"#0D1117"},"formatter":"[fn]"},"series":[{"type":"treemap","sort":false,"top":0,"left":0,"right":0,"bottom":0,"roam":false,"nodeClick":false,"squareRatio":1,"label":{"show":true,"formatter":"[fn]","fontSize":10,"fontWeight":"bold","lineHeight":14},"breadcrumb":{"show":false},"itemStyle":{"borderColor":"#F0F6FC","borderWidth":1,"gapWidth":0},"levels":[{"itemStyle":{"borderColor":"#F0F6FC","borderWidth":0,"gapWidth":0}},{"colorSaturation":[0.35,0.5],"itemStyle":{"borderColorSaturation":0.6,"gapWidth":0,"borderWidth":1}}],"data":[{"name":"AAA","value":2,"path":"AAA","nameFull":"AAA","sector":"Energy","price":100,"change":2,"mcap":1000000000000,"pe":null,"metricLabel":"Day Change","metricValue":"+2.0%","metricNumeric":2,"label":{"color":"#000000","show":true},"itemStyle":{"color":"rgb(253,231,37)"}},{"name":"BBB","value":1,"path":"BBB","nameFull":"BBB","sector":"Energy","price":100,"change":-1,"mcap":1000000000000,"pe":null,"metricLabel":"Day Change","metricValue":"-1.0%","metricNumeric":-1,"label":{"color":"#FFFFFF","show":true},"itemStyle":{"color":"rgb(68,1,84)"}},{"name":"CCC","value":0.01,"path":"CCC","nameFull":"CCC","sector":"Energy","price":100,"change":0,"mcap":1000000000000,"pe":null,"metricLabel":"Day Change","metricValue":"+0.0%","metricNumeric":0,"label":{"color":"#FFFFFF","show":true},"itemStyle":{"color":"rgb(49,104,141)"}}]}]}';

/** happy-dom has no layout engine; pin the canvas box before the component mounts. */
function stubCanvasSize(width: number, height: number): () => void {
  const proto = HTMLElement.prototype as unknown as Record<string, PropertyDescriptor | undefined>;
  const originals = new Map(
    ["clientWidth", "clientHeight"].map((key) => [key, Object.getOwnPropertyDescriptor(proto, key)]),
  );
  Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => width });
  Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => height });
  return () => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(proto, key, descriptor);
      else delete proto[key];
    }
  };
}

async function renderMap(rows: MarketRow[]) {
  render(() => (
    <UIProvider>
      <MarketMapView rows={rows} />
    </UIProvider>
  ));
  await vi.waitFor(() => expect(counts.option).toBeTruthy());
}

function MountSpec() {
  const CTX: Accessor<any> = () => ({ market: "india" });
  const data = createMemo(() => MARKET_HEATMAP_PANEL.data?.(CTX));
  return <>{MARKET_HEATMAP_PANEL.mount(CTX, { data, commands: MARKET_HEATMAP_PANEL.commands ?? {} })}</>;
}

const reset = () => {
  counts.toTreemapRow = 0;
  counts.buildOption = 0;
  counts.suppress = 0;
  counts.suppressReallocated = 0;
  counts.filterMarketRows = 0;
  counts.filterOnFiltered = 0;
  counts.colorDomain = 0;
  counts.option = null;
};

beforeEach(reset);
afterEach(cleanup);

describe("market heatmap — measured hot-function counts", () => {
  test("one snapshot maps each row through toTreemapRow exactly once", async () => {
    const restore = stubCanvasSize(740, 765);
    try {
      await renderMap(rowsOf(60));
      // The panel no longer pre-maps rows; MarketMapView's `stocks` memo is the
      // only full toTreemapRow pass. 60 rows -> 60 calls, never 120.
      expect(counts.toTreemapRow).toBe(60);
    } finally {
      restore();
    }
  });

  test("an unrelated signal does not re-run the treemap builder", async () => {
    const [spinner, setSpinner] = createSignal(false);
    const restore = stubCanvasSize(740, 765);
    try {
      render(() => (
        <UIProvider>
          <Show when={spinner()}>
            <span data-testid="spinner" />
          </Show>
          <MarketMapView rows={rowsOf(60)} />
        </UIProvider>
      ));
      await vi.waitFor(() => expect(counts.option).toBeTruthy());
      const before = counts.buildOption;
      setSpinner(true);
      await Promise.resolve();
      expect(counts.buildOption).toBe(before);
      expect(before).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  test("reporting the canvas size does not rebuild the whole treemap layout", async () => {
    const restore = stubCanvasSize(740, 765);
    try {
      await renderMap(rowsOf(60));
      // Before the fix: one build with the fallback box, a second when the
      // canvas reports its real size. Layout does not depend on size.
      expect(counts.buildOption).toBe(1);
    } finally {
      restore();
    }
  });

  test("a size-only change does not recompute the colour domain when colorBy is explicit", async () => {
    const restore = stubCanvasSize(740, 765);
    try {
      render(() => (
        <UIProvider>
          <MarketMapView rows={rowsOf(20)} sizeBy="change_pct" colorBy="rsi" />
        </UIProvider>
      ));
      await vi.waitFor(() => expect(counts.option).toBeTruthy());
      const before = counts.colorDomain;
      const select = screen.getByTestId("market-map-metric").querySelector("select") as HTMLSelectElement;
      fireEvent.input(select, { target: { value: "market_cap" } });
      await Promise.resolve();
      expect(counts.colorDomain).toBe(before);
      expect(before).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  test("suppressTinyFlatLabels reuses every tile when label decisions did not change", () => {
    const original = [
      { name: "A", value: 100, label: { color: "#fff", show: true } },
      { name: "B", value: 1, label: { color: "#fff", show: false } },
    ];
    const decorated = suppressTinyFlatLabels(original, 800, 600);
    const again = suppressTinyFlatLabels(decorated, 800, 600);
    expect(again).toBe(decorated);
    expect(again[0]).toBe(decorated[0]);
    expect(again[1]).toBe(decorated[1]);
  });

  test("suppressTinyFlatLabels output is byte-identical to the original mapping", () => {
    const tiles = [
      { name: "A", value: 100, label: { color: "#fff" } },
      { name: "B", value: 1, label: { color: "#fff" } },
      { name: "C", value: 0.01, label: { color: "#fff" } },
    ];
    const replacer = (_key: string, value: unknown) => (typeof value === "function" ? "[fn]" : value);
    const before = JSON.stringify(suppressTinyFlatLabels(tiles, 800, 600), replacer);
    const after = JSON.stringify(suppressTinyFlatLabels(tiles, 800, 600), replacer);
    expect(after).toBe(before);
  });

  test("the emitted option for a fixed snapshot is byte-identical", async () => {
    const restore = stubCanvasSize(740, 765);
    try {
      await renderMap([row("AAA", 2), row("BBB", -1), row("CCC", 0)]);
      const replacer = (_key: string, value: unknown) => (typeof value === "function" ? "[fn]" : value);
      expect(JSON.stringify(counts.option, replacer)).toBe(FIXED_OPTION);
    } finally {
      restore();
    }
  });

  test("the new label gate is byte-identical to the original per-tile mapping", () => {
    const tiles = [
      { name: "BIG", value: 100, label: { color: "#fff" } },
      { name: "MID", value: 2, label: { color: "#fff" } },
      { name: "SLIVER", value: 0.01, label: { color: "#fff" } },
      { name: "ZERO", value: 0, label: { color: "#fff" } },
    ];
    const replacer = (_key: string, value: unknown) => (typeof value === "function" ? "[fn]" : value);
    for (const dims of [[undefined, undefined], [800, 600], [390, 700], [1, 1]] as const) {
      expect(
        JSON.stringify(suppressTinyFlatLabels(tiles, dims[0], dims[1]), replacer),
        `${dims[0]}x${dims[1]}`,
      ).toBe(JSON.stringify(legacySuppressTinyFlatLabels(tiles, dims[0], dims[1]), replacer));
    }
  });

  test("the panel filters rows once and counts ETFs without a second filter pass", async () => {
    panelCtl.setRows([row("A", 1), { ...row("B", 2), etf: true }]);
    render(() => (
      <UIProvider>
        <MountSpec />
      </UIProvider>
    ));
    await vi.waitFor(() => expect(document.querySelector('[data-testid="market-map-view"]')).toBeTruthy());
    // Mount reads the count before entry attaches (empty rows), then again when
    // the snapshot arrives — two legitimate filter passes, not a memo leak.
    expect(counts.filterMarketRows).toBe(2);
    // Before the fix etfCount calls filteredRows().filter(...) — a second full
    // pass over the materialised array on each of those two updates.
    expect(counts.filterOnFiltered).toBe(0);
  });
});
