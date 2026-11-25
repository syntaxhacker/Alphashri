// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { JSX } from "solid-js";
import { UIProvider } from "@/ui";
import { MarketScreenerPanel } from "./MarketScreenerPanel";
import type { SectionDefinition } from "../../state/sections/types";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSymbol: vi.fn(),
  fetchSectionScan: vi.fn(),
  sections: [] as SectionDefinition[],
  hydrating: false,
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
vi.mock("../../api/valueScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/valueScan")>();
  return { ...actual, valueScan: vi.fn(async () => ({
    market: "india", currency: "INR", as_of: "2026-11-25T09:00:00+05:30",
    scanned: 0, matched: 0, fields_complete: true, filters_applied: {},
    warnings: [], rows: [], sectors: [],
  })) };
});
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
    hydrated: () => !mocks.hydrating,
    status: () => "idle",
  }),
}));

// The real components are owned by another lane. These shallow stand-ins keep
// this suite about the tab's own wiring, not the table/modal internals.
vi.mock("./SectionTable", () => ({
  SectionTable: (props: {
    section: SectionDefinition;
    rows: unknown[];
    error?: string | null;
    loading?: boolean;
    onOpenSymbol?: (symbol: string) => void;
  }) => {
    const el = document.createElement("div");
    el.setAttribute("data-testid", "section-table");
    el.setAttribute("data-section-id", props.section.id);
    el.textContent = `${props.section.name}|${props.rows.length}|${props.error ?? ""}|${props.loading ? "loading" : ""}`;
    if (props.onOpenSymbol) {
      const open = document.createElement("button");
      open.setAttribute("data-testid", `section-open-${props.section.id}`);
      open.onclick = () => props.onOpenSymbol!("TESTSYM");
      el.appendChild(open);
    }
    return el;
  },
}));

vi.mock(
  "./SectionManagerModal",
  () => ({
    SectionManagerModal: (props: { opened: boolean }) => {
      if (!props.opened) return null;
      const el = document.createElement("div");
      el.setAttribute("data-testid", "section-manager-modal");
      el.textContent = "Signal Sections";
      return el;
    },
  }),
  { virtual: true },
);

const section = (id: string, overrides: Partial<SectionDefinition> = {}): SectionDefinition => ({
  id,
  name: id,
  description: "test section",
  concept: "momentum_5m",
  side: "long",
  conditions: [{ metric: "change|5", op: "gte", value: 1.5 }],
  render: { type: "table", columns: ["symbol", "change|5"] },
  refreshSec: 60,
  enabled: true,
  pinned: false,
  ...overrides,
});

const scanResult = (overrides: Record<string, unknown> = {}) => ({
  market: "india",
  generated_at: "2026-11-25T09:00:00+05:30",
  row_count: 0,
  delayed_rows: 0,
  note: null,
  rows: [],
  ...overrides,
});

function renderPanel(jsx: () => JSX.Element) {
  return render(() => <UIProvider>{jsx()}</UIProvider>);
}

async function openSectionsTab() {
  await fireEvent.click(within(screen.getByTestId("market-view-toggle")).getByText("Sections"));
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
  mocks.sections = [];
  mocks.hydrating = false;
  mocks.fetchSectionScan.mockResolvedValue(scanResult());
});

describe("MarketScreenerPanel — Sections tab", () => {
  test("adds a Sections tab beside the existing views and fetches on activation", async () => {
    const pinned = section("vwap-reclaim", { pinned: true });
    const plain = section("momentum-5m");
    mocks.sections = [plain, section("disabled", { enabled: false }), pinned];

    renderPanel(() => <MarketScreenerPanel />);

    expect(within(screen.getByTestId("market-view-toggle")).getByText("Sections")).toBeInTheDocument();
    await openSectionsTab();

    expect(screen.getByTestId("market-sections-region")).toBeInTheDocument();
    expect(screen.queryByTestId("market-search")).not.toBeInTheDocument();
    expect(mocks.fetchSectionScan).toHaveBeenCalledTimes(1);
    expect(mocks.fetchSectionScan).toHaveBeenCalledWith("india", [pinned, plain], true);
    const tables = await screen.findAllByTestId("section-table");
    expect(tables).toHaveLength(2);
    expect(tables.map((t) => t.getAttribute("data-section-id"))).toEqual([
      "vwap-reclaim",
      "momentum-5m",
    ]);
  });

  test("refreshes explicitly with one request per market, and forwards the delayed opt-in", async () => {
    mocks.sections = [section("momentum-5m")];
    renderPanel(() => <MarketScreenerPanel />);
    await openSectionsTab();
    expect(mocks.fetchSectionScan).toHaveBeenCalledTimes(1);

    await fireEvent.click(screen.getByTestId("market-sections-refresh"));
    expect(mocks.fetchSectionScan).toHaveBeenCalledTimes(2);

    // Delayed is on by default; toggling it off must forward streaming-only.
    expect(screen.getByTestId("market-sections-allow-delayed")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await fireEvent.click(screen.getByTestId("market-sections-allow-delayed"));
    await fireEvent.click(screen.getByTestId("market-sections-refresh"));
    expect(mocks.fetchSectionScan).toHaveBeenCalledTimes(3);
    expect(mocks.fetchSectionScan).toHaveBeenLastCalledWith(
      "india",
      [mocks.sections[0]],
      false,
    );
  });

  test("collapses an empty section list to a single reason line", async () => {
    mocks.sections = [];
    renderPanel(() => <MarketScreenerPanel />);
    await openSectionsTab();

    expect(screen.getByTestId("market-sections-empty")).toHaveTextContent(/no (enabled )?sections/i);
    expect(screen.queryAllByTestId("section-table")).toHaveLength(0);
    expect(mocks.fetchSectionScan).not.toHaveBeenCalled();
  });

  test("shows the failure reason and Retry instead of an empty table", async () => {
    mocks.sections = [section("momentum-5m")];
    mocks.fetchSectionScan.mockRejectedValue(new Error("scanner upstream unavailable"));
    renderPanel(() => <MarketScreenerPanel />);
    await openSectionsTab();

    expect(await screen.findByTestId("market-sections-error")).toHaveTextContent(
      "scanner upstream unavailable",
    );
    expect(screen.queryAllByTestId("section-table")).toHaveLength(0);

    await fireEvent.click(screen.getByTestId("market-sections-retry"));
    expect(mocks.fetchSectionScan).toHaveBeenCalledTimes(2);
  });

  test("surfaces the delayed-data note and count", async () => {
    mocks.sections = [section("momentum-5m")];
    mocks.fetchSectionScan.mockResolvedValue(
      scanResult({
        delayed_rows: 2,
        row_count: 3,
        note: "Including 2 delayed row(s); data may be up to 15 minutes old.",
      }),
    );
    renderPanel(() => <MarketScreenerPanel />);
    await openSectionsTab();

    expect(await screen.findByTestId("market-sections-note")).toHaveTextContent(
      "Including 2 delayed row(s)",
    );
    expect(screen.getByTestId("market-sections-delayed")).toHaveTextContent("2");
  });

  test("+ Add section opens the manager modal", async () => {
    renderPanel(() => <MarketScreenerPanel />);
    await openSectionsTab();

    expect(screen.queryByTestId("section-manager-modal")).not.toBeInTheDocument();
    await fireEvent.click(screen.getByTestId("market-sections-add"));
    expect(await screen.findByTestId("section-manager-modal")).toBeInTheDocument();
  });

  test("forwards selectAndOpen to every section table so a symbol opens the chart dock", async () => {
    mocks.sections = [section("vwap-reclaim"), section("momentum-5m")];
    renderPanel(() => <MarketScreenerPanel />);
    await openSectionsTab();

    const tables = await screen.findAllByTestId("section-table");
    expect(tables).toHaveLength(2);
    for (const table of tables) {
      const id = table.getAttribute("data-section-id")!;
      await fireEvent.click(within(table).getByTestId(`section-open-${id}`));
    }

    expect(mocks.openSymbol).toHaveBeenCalledTimes(2);
    expect(mocks.openSymbol).toHaveBeenCalledWith("TESTSYM");
  });

  test("switching back to Table restores the market chrome", async () => {
    mocks.sections = [section("momentum-5m")];
    renderPanel(() => <MarketScreenerPanel />);
    await openSectionsTab();
    await fireEvent.click(within(screen.getByTestId("market-view-toggle")).getByText("Table"));

    expect(screen.queryByTestId("market-sections-region")).not.toBeInTheDocument();
    expect(screen.getByTestId("market-search")).toBeInTheDocument();
  });
});
