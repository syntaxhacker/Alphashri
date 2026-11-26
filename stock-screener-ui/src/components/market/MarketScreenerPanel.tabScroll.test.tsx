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

vi.mock("./useMarketSnapshotSolid", () => ({
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
}));

vi.mock("./usePatternSummary", () => ({
  usePatternSummary: () => ({ summary: () => new Map(), loading: () => false }),
}));

vi.mock("../../api/screenerDashboard", () => ({ fetchScreenerDashboard: vi.fn() }));
vi.mock("../../api/valueScan", () => ({
  valueScan: vi.fn(async () => ({
    market: "india",
    currency: "INR",
    as_of: "2026-11-25T09:00:00+05:30",
    scanned: 0,
    matched: 0,
    fields_complete: true,
    filters_applied: {},
    warnings: [],
    rows: [],
    sectors: [],
  })),
}));
vi.mock("../../api/userConfigs", () => ({
  getUserConfig: vi.fn(async () => null),
  putUserConfig: vi.fn(async (_s: string, c: unknown) => c),
  deleteUserConfig: vi.fn(async () => ({ scope: "", deleted: true })),
  UserConfigError: class UserConfigError extends Error {
    status = 0;
    code = "";
    payload = undefined;
  },
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
  () => ({ SectionManagerModal: () => null }),
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

const rows: SectionScanRow[] = Array.from({ length: 4 }, (_, i) => ({
  symbol: `SYM-${String(i).padStart(3, "0")}`,
  name: `Symbol ${i}`,
  fields: { close: 100 + i, "change|5": 0.5 },
  signals: { momentum_5m: i === 0 },
}));

const SCROLL_OWNER = /(?:^|\s)overflow-x-(?:auto|scroll)(?:\s|$)/;
const TAB_LABELS = ["Table", "Vis", "Movers", "Deep Value", "Sections"];

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
  mocks.sections = [section];
  mocks.fetchSectionScan.mockResolvedValue({
    market: "india",
    generated_at: "2026-11-25T09:00:00+05:30",
    row_count: rows.length,
    delayed_rows: 0,
    note: null,
    rows,
  });
  // A 390px viewport: every max-width media query in the panel reports narrow.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: /max-width/.test(query),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

describe("Screener tab strip at 390px", () => {
  test("one scroll owner and one cue make every tab reachable without clipping", async () => {
    render(() => <UIProvider>{<MarketScreenerPanel /> as JSX.Element}</UIProvider>);

    const strip = screen.getByTestId("market-view-toggle");
    for (const label of TAB_LABELS) {
      expect(within(strip).getByText(label), label).toBeInTheDocument();
    }
    expect(strip.className).toMatch(SCROLL_OWNER);
    expect(strip.className).not.toContain("overflow-hidden");
    // Labels cannot compress: no "Deep V" / absent "Sections" at rest.
    for (const button of strip.querySelectorAll("button")) {
      expect(button.className, button.textContent ?? "").toContain("min-w-max");
      expect(button.className, button.textContent ?? "").toContain("whitespace-nowrap");
    }

    const toolbar = screen.getByTestId("market-toolbar");
    const owners = [...toolbar.querySelectorAll<HTMLElement>("*")].filter((el) =>
      SCROLL_OWNER.test(el.className),
    );
    expect(owners).toEqual([strip]);

    Object.defineProperty(strip, "clientWidth", { configurable: true, value: 150 });
    Object.defineProperty(strip, "scrollWidth", { configurable: true, value: 330 });
    Object.defineProperty(strip, "scrollLeft", {
      configurable: true,
      writable: true,
      value: 0,
    });
    window.dispatchEvent(new Event("resize"));

    const cues = screen.getAllByTestId("market-view-scroll");
    expect(cues).toHaveLength(1);
    expect(cues[0]).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Scroll tabs" })).toHaveLength(1);

    fireEvent.click(cues[0]!);
    expect(strip.scrollLeft).toBeGreaterThan(0);

    await fireEvent.click(within(strip).getByText("Sections"));
    expect(within(strip).getByText("Sections").closest("button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
