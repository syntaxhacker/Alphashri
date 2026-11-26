// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { JSX } from "solid-js";
import { UIProvider } from "@/ui";
import { MarketScreenerPanel } from "./MarketScreenerPanel";
import type { SectionDefinition } from "../../state/sections/types";
import type { SectionScanRow } from "./SectionTable";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSymbol: vi.fn(),
  fetchSectionScan: vi.fn(),
  sections: [] as SectionDefinition[],
}));

vi.mock("@solidjs/router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useNavigate: () => mocks.navigate };
});

vi.mock("../common/symbolDockContext", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useSymbolDock: () => ({
      preview: vi.fn(),
      endPreview: vi.fn(),
      open: mocks.openSymbol,
      close: vi.fn(),
      pinned: false,
      setOutlet: vi.fn(),
      symbol: () => null,
    }),
  };
});

vi.mock("./useMarketSnapshotSolid", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMarketSnapshotSolid: () => ({
      rows: () => [],
      total: () => 0,
      updateMode: () => "streaming",
      asOf: () => null,
      isLoading: () => false,
      error: () => null,
      refresh: vi.fn(),
      stale: () => false,
      ageSec: () => null,
      warming: () => false,
    }),
    isLiveUniverse: () => true,
  };
});

vi.mock("./usePatternSummary", () => ({
  usePatternSummary: () => ({ summary: () => new Map(), loading: () => false }),
}));

vi.mock("../../api/screenerDashboard", () => ({ fetchScreenerDashboard: vi.fn() }));
vi.mock("../../api/valueScan", () => ({
  valueScan: vi.fn(async () => ({
    market: "india", currency: "INR", as_of: "2026-11-25T09:00:00+05:30",
    scanned: 0, matched: 0, fields_complete: true, filters_applied: {},
    warnings: [], rows: [], sectors: [],
  })),
}));
vi.mock("../../api/userConfigs", () => ({
  getUserConfig: vi.fn(async () => null),
  putUserConfig: vi.fn(async (_s: string, c: unknown) => c),
  deleteUserConfig: vi.fn(async () => ({ scope: "", deleted: true })),
  UserConfigError: class UserConfigError extends Error { status = 0; code = ""; payload = undefined; },
}));
vi.mock("../../utils/loadEcharts", () => ({ loadEcharts: vi.fn() }));
vi.mock("../../api/sections", () => ({ fetchSectionScan: mocks.fetchSectionScan }));
vi.mock("../../state/sections/config", () => ({
  useSectionsConfig: () => ({
    config: () => ({ sections: mocks.sections, version: 1 }),
    setConfig: vi.fn(),
    upsert: vi.fn(),
    remove: vi.fn(),
    hydrated: () => true,
    status: () => "idle",
  }),
}));
vi.mock(
  "./SectionManagerModal",
  () => ({
    SectionManagerModal: () => null,
  }),
  { virtual: true },
);

const section: SectionDefinition = {
  id: "momentum-5m",
  name: "Momentum 5m",
  description: "Five-minute momentum",
  concept: "momentum_5m",
  side: "long",
  conditions: [{ metric: "change|5", op: "gt", value: 0 }],
  render: { type: "table", columns: ["close", "change|5"] },
  refreshSec: 60,
  enabled: true,
  pinned: false,
};

// Enough rows that a real viewport must scroll; their presence is the moment
// the user expects the wheel to work without a second interaction.
const manyRows: SectionScanRow[] = Array.from({ length: 40 }, (_, i) => ({
  symbol: `SYM-${String(i).padStart(3, "0")}`,
  name: `Symbol ${i}`,
  fields: { close: 100 + i, "change|5": 0.5 },
  signals: { momentum_5m: i === 0 },
}));

const scrollOwnerClasses = /(?:^|\s)overflow-(?:y-)?(?:auto|scroll)(?:\s|$)/;

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
  mocks.sections = [section];
  mocks.fetchSectionScan.mockResolvedValue({
    market: "india",
    generated_at: "2026-11-25T09:00:00+05:30",
    row_count: manyRows.length,
    delayed_rows: 0,
    note: null,
    rows: manyRows,
  });
});

describe("Sections tab — scroll owner on first data load", () => {
  test("rows are scrollable immediately: one vertical scroll owner, bounded rows", async () => {
    render(() => <UIProvider>{<MarketScreenerPanel /> as JSX.Element}</UIProvider>);
    await fireEvent.click(within(screen.getByTestId("market-view-toggle")).getByText("Sections"));

    const firstRow = await screen.findByTestId("section-symbol-SYM-039");
    expect(firstRow).toBeInTheDocument();
    expect(screen.queryByTestId("section-table-loading-momentum-5m")).toBeNull();

    const region = screen.getByTestId("market-sections-region");
    const grid = screen.getByTestId("market-sections-grid");
    // The table is the single scrollport; the tab grid must not become a second
    // one that captures the first wheel after rows arrive.
    const owners = Array.from(region.querySelectorAll<HTMLElement>("*")).filter((el) =>
      scrollOwnerClasses.test(el.className),
    );
    expect(owners.map((el) => el.className)).toEqual([expect.stringContaining("paper-tanstack-scroll")]);
    expect(grid.className).not.toMatch(scrollOwnerClasses);
    // Without bounded rows the table grows to content height and never scrolls.
    expect(grid.className).toContain("auto-rows-[minmax(0,1fr)]");

    const viewport = region.querySelector<HTMLElement>(".paper-tanstack-scroll")!;
    Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 100 });
    Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 600 });
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
    viewport.scrollTop = 0;
    viewport.scrollTop = 120;
    expect(viewport.scrollTop).toBe(120);
    expect(grid.scrollTop).toBe(0);
  });
});
