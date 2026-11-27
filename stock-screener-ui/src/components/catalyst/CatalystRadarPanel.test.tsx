// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { TestWrapper } from "@/test-utils/renderWithProviders";
import { CatalystRadarPanel } from "./CatalystRadarPanel";
import type { CatalystRowLike, CatalystTodayView } from "./catalystRows";

const store = vi.hoisted(() => ({
  data: null as unknown,
  loading: false,
  error: null as string | null,
  sector: "auto",
  sectors: [
    { id: "auto", label: "NIFTY AUTO" },
    { id: "it", label: "NIFTY IT" },
  ] as { id: string; label: string }[],
  setSector: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/state/catalystStore", () => ({
  useCatalystToday: () => ({
    data: () => store.data,
    loading: () => store.loading,
    error: () => store.error,
    sector: () => store.sector,
    sectors: () => store.sectors,
    setSector: store.setSector,
    refresh: store.refresh,
  }),
}));

const AS_OF = "2026-11-19T10:32:00+05:30";

function row(overrides: Partial<CatalystRowLike> & { symbol: string }): CatalystRowLike {
  return {
    name: overrides.symbol,
    sector: "Auto",
    kind: "news",
    headline: `${overrides.symbol} catalyst headline`,
    source: "Business Standard",
    source_url: "https://example.com/story",
    first_seen: "2026-11-19T10:31:00+05:30",
    event_at: "2026-11-19T09:15:00+05:30",
    state: "confirmed",
    score: "high",
    move_pct: 6.5,
    rel_volume: 2.4,
    reasons: [],
    invalidates: [],
    ...overrides,
  };
}

const MARUTI = row({
  symbol: "MARUTI",
  name: "Maruti Suzuki",
  sector: "Auto",
  headline: "Investor meetings 17-19 Nov; stock near 52-week low",
  state: "confirmed",
  score: "high",
  reasons: ["GST small-car demand", "Stock -25% YTD"],
  invalidates: ["Nifty Auto gives back >1.5%", "Breadth falls below 8/15"],
});

const TCS = row({
  symbol: "TCS",
  name: "Tata Consultancy Services",
  sector: "IT",
  kind: "event",
  headline: "Analyst day scheduled",
  source: "Mint",
  source_url: "https://example.com/tcs",
  first_seen: "2026-11-19T10:05:00+05:30",
  state: "scheduled",
  score: "medium",
  move_pct: null,
  rel_volume: null,
  reasons: ["Scheduled analyst day"],
  invalidates: [],
});

const M_M = row({
  symbol: "M&M",
  name: "Mahindra & Mahindra",
  sector: "Auto",
  state: "fading",
  score: "low",
  move_pct: -1.2,
  rel_volume: null,
  reasons: [],
});

function payload(overrides: Partial<CatalystTodayView> = {}): CatalystTodayView {
  return {
    as_of: AS_OF,
    market: {},
    sector: {
      id: "auto",
      label: "NIFTY AUTO",
      change_pct: 3.75,
      relative_strength_pct: 3.45,
      breadth: { advancing: 12, declining: 3, total: 15 },
    },
    rows: [MARUTI, TCS, M_M],
    counts: { high: 1, medium: 1, low: 1, total: 3 },
    warnings: [],
    ...overrides,
  } as CatalystTodayView;
}

function renderPanel(now?: number) {
  return render(
    () => <CatalystRadarPanel now={now == null ? undefined : () => now} />,
    { wrapper: TestWrapper },
  );
}

beforeEach(() => {
  store.data = null;
  store.loading = false;
  store.error = null;
  store.sector = "auto";
  store.setSector.mockClear();
  store.refresh.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CatalystRadarPanel states", () => {
  test("shows a loader until the first payload arrives", () => {
    store.loading = true;
    renderPanel();

    expect(screen.getByTestId("catalyst-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("catalyst-empty")).not.toBeInTheDocument();
  });

  test("renders an explicit empty state when no catalysts are published", () => {
    store.data = payload({ rows: [] });
    renderPanel();

    expect(screen.getByTestId("catalyst-empty")).toHaveTextContent(
      "No catalysts in this session yet",
    );
  });

  test("renders the error with a working retry when the first fetch fails", () => {
    store.error = "Catalyst service unreachable";
    renderPanel();

    expect(screen.getByTestId("catalyst-error")).toHaveTextContent(
      "Catalyst service unreachable",
    );
    fireEvent.click(screen.getByTestId("catalyst-error-retry"));

    expect(store.refresh).toHaveBeenCalledTimes(1);
  });

  test("a dead source warning is visible but does not hide rows", () => {
    store.data = payload({ warnings: ["event_source_unavailable"] });
    renderPanel();

    expect(screen.getByTestId("catalyst-warnings")).toHaveTextContent(
      "EVENT SOURCE UNAVAILABLE",
    );
    expect(screen.getByTestId("catalyst-row-MARUTI")).toBeInTheDocument();
    expect(screen.getByTestId("catalyst-row-TCS")).toBeInTheDocument();
  });

  test("marks a lagging payload stale without hiding rows", () => {
    store.data = payload({ as_of: "2026-11-19T10:00:00+05:30" });
    renderPanel(Date.parse("2026-11-19T10:30:00+05:30"));

    expect(screen.getByTestId("catalyst-stale")).toHaveTextContent("no update since 10:00 IST");
    expect(screen.getByTestId("catalyst-asof")).toHaveTextContent("STALE 10:00 IST");
    expect(screen.getByTestId("catalyst-row-MARUTI")).toBeInTheDocument();
  });

  test("copies the display symbol from a symbol cell without expanding the row", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    store.data = payload({ rows: [row({ symbol: "NSE:MARUTI", name: "Maruti Suzuki" })] });
    renderPanel();

    const text = screen.getByTestId("catalyst-symbol-NSE:MARUTI");
    expect(text).toHaveTextContent("MARUTI");
    const copy = screen.getByTestId("copy-symbol-MARUTI");
    expect(copy).toHaveAttribute("aria-label", "Copy MARUTI");

    await fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith("MARUTI");
    expect(screen.queryByTestId("catalyst-detail-NSE:MARUTI")).toBeNull();
  });

  test("reports the confirmed count from the rows, not the payload counts", () => {
    store.data = payload({ counts: { high: 1, medium: 1, low: 0, total: 9 } });
    renderPanel();

    expect(screen.getByTestId("catalyst-confirmed-count")).toHaveTextContent("CONFIRMED 1/3");
  });
});

describe("CatalystRadarPanel filters", () => {
  test("SCHED narrows the table to scheduled catalysts", () => {
    store.data = payload();
    renderPanel();

    fireEvent.click(
      within(screen.getByTestId("catalyst-filters")).getByText("SCHEDULED"),
    );

    expect(screen.getByTestId("catalyst-row-TCS")).toBeInTheDocument();
    expect(screen.queryByTestId("catalyst-row-MARUTI")).not.toBeInTheDocument();
    expect(screen.queryByTestId("catalyst-row-M&M")).not.toBeInTheDocument();
  });

  test("SECTOR keeps only rows in the selected payload sector", () => {
    store.data = payload();
    renderPanel();

    fireEvent.click(within(screen.getByTestId("catalyst-filters")).getByText("SECTOR"));

    expect(screen.getByTestId("catalyst-row-MARUTI")).toBeInTheDocument();
    expect(screen.queryByTestId("catalyst-row-TCS")).not.toBeInTheDocument();
  });

  test("the sector selector requests another sector", () => {
    store.data = payload();
    renderPanel();

    const select = screen.getByTestId("catalyst-sector-select").querySelector("select")!;
    fireEvent.input(select, { target: { value: "it" } });
    expect(store.setSector).toHaveBeenCalledWith("it");
  });

  test("a filter with no matches offers a way back to all rows", () => {
    store.data = payload({ rows: [MARUTI] });
    renderPanel();

    fireEvent.click(within(screen.getByTestId("catalyst-filters")).getByText("SCHEDULED"));

    expect(screen.getByTestId("catalyst-empty")).toHaveTextContent(
      "No catalysts match SCHEDULED",
    );
    fireEvent.click(screen.getByTestId("catalyst-empty-clear"));

    expect(screen.getByTestId("catalyst-row-MARUTI")).toBeInTheDocument();
  });
});

describe("CatalystRadarPanel row detail", () => {
  test("clicking a row expands why now, confirmation, invalidations and the source", () => {
    store.data = payload();
    renderPanel();

    fireEvent.click(screen.getByTestId("catalyst-row-MARUTI"));

    const detail = screen.getByTestId("catalyst-detail-MARUTI");
    expect(within(detail).getByText("GST small-car demand")).toBeInTheDocument();
    expect(within(detail).getByText("Stock -25% YTD")).toBeInTheDocument();
    expect(within(detail).getByText("Nifty Auto gives back >1.5%")).toBeInTheDocument();
    expect(within(detail).getByText("+6.50% · 2.4× vol · 12/15 adv")).toBeInTheDocument();
    expect(within(detail).getByTestId("catalyst-source-MARUTI")).toHaveAttribute(
      "href",
      "https://example.com/story",
    );
  });

  test("the row is keyboard operable and a second press collapses it", () => {
    store.data = payload();
    renderPanel();

    const rowEl = screen.getByTestId("catalyst-row-MARUTI");
    fireEvent.keyDown(rowEl, { key: "Enter" });
    expect(screen.getByTestId("catalyst-detail-MARUTI")).toBeInTheDocument();

    fireEvent.keyDown(rowEl, { key: " " });
    expect(screen.queryByTestId("catalyst-detail-MARUTI")).not.toBeInTheDocument();
  });

  test("the chevron control is reachable and labelled", () => {
    store.data = payload();
    renderPanel();

    const toggle = screen.getByTestId("catalyst-toggle-MARUTI");
    expect(toggle).toHaveAttribute("aria-label", "Expand catalyst");
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-label", "Collapse catalyst");
  });
});

describe("CatalystRadarPanel table contract", () => {
  test("every column header carries its declared alignment", () => {
    store.data = payload();
    renderPanel();

    const expected: [string, string][] = [
      ["Symbol", "left"],
      ["Catalyst", "left"],
      ["First seen", "left"],
      ["State", "center"],
      ["Confirmation", "right"],
      ["Score", "center"],
    ];

    for (const [header, align] of expected) {
      const th = screen.getByText(header).closest("th") as HTMLTableCellElement;
      expect(th, `${header} header`).not.toBeNull();
      expect(th.style.textAlign, `${header} header align`).toBe(align);
    }
  });
});

describe("catalyst.radar panel spec", () => {
  test("mount ignores the dock context and renders the catalyst radar", async () => {
    store.data = payload();
    const { CATALYST_RADAR_PANEL } = await import("../window/panels/catalystRadar");

    render(
      () => CATALYST_RADAR_PANEL.mount(() => ({}), { data: () => undefined, commands: {} }),
      { wrapper: TestWrapper },
    );

    expect(CATALYST_RADAR_PANEL.id).toBe("catalyst.radar");
    expect(CATALYST_RADAR_PANEL.page).toBe("report");
    expect(CATALYST_RADAR_PANEL.minWidth).toBe(320);
    expect(CATALYST_RADAR_PANEL.singleton).toBe(true);
    expect(CATALYST_RADAR_PANEL.requires).toEqual([]);
    expect(screen.getByTestId("catalyst-radar-panel")).toBeInTheDocument();
    expect(screen.getByTestId("catalyst-title")).toHaveTextContent("CATALYST RADAR");
  });
});
