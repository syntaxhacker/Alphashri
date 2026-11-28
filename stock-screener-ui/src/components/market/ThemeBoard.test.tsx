// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import { parseColor } from "@/utils/contrast";
import { alpha, VIZ_BG, VIZ_PANEL, VIZ_TEXT } from "@/ui/palette";
import { marketTileColor } from "./marketTreemap";
import type { SectorGroupsPayload, SectorPeriod } from "@/types/sector";
import type { MarketRow } from "@/types/marketScreener";
import { ThemeBoard } from "./ThemeBoard";

const THEME_NAMES = [
  "AI Infrastructure",
  "Semiconductors",
  "Cloud Computing",
  "Electric Vehicles",
  "Renewable Energy",
  "Defence",
  "Banking",
  "Fintech",
  "Pharma",
  "Biotech",
  "FMCG",
  "Agri Inputs",
  "Metals",
  "Mining",
  "Oil and Gas",
  "Chemicals",
  "Textiles",
  "Autos",
  "Railways",
  "Logistics",
  "Construction",
  "Real Estate",
  "Power",
  "Telecom",
] as const;

const viewport = vi.hoisted(() => ({ narrow: false }));
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: query.includes("min-width: 900px") ? !viewport.narrow : false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
}) as unknown as MediaQueryList);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flush only microtasks — no sleeps, so an out-of-order assertion is stable. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

type GroupHandler = (params: { period?: string; classify?: string }) => Promise<SectorGroupsPayload>;
type DetailHandler = (slug: string) => Promise<{
  theme: { slug: string; name: string; category: string | null; description: string; member_count: number };
  constituents: string[];
}>;

const state = vi.hoisted(() => ({
  calls: [] as Array<{ classify?: string; period?: string; signal?: AbortSignal }>,
  detailCalls: [] as Array<{ slug: string; signal?: AbortSignal }>,
  groupsHandler: null as GroupHandler | null,
  detailHandler: null as DetailHandler | null,
}));

vi.mock("@/api/sector", () => ({
  fetchSectorGroups: (params: { classify?: string; period?: string; signal?: AbortSignal } = {}) => {
    state.calls.push({ classify: params.classify, period: params.period, signal: params.signal });
    return state.groupsHandler
      ? state.groupsHandler(params)
      : Promise.resolve(groupPayload((params.period as SectorPeriod) ?? "1D"));
  },
}));

vi.mock("@/api/rotation", () => ({
  fetchThemeDetail: (slug: string, signal?: AbortSignal) => {
    state.detailCalls.push({ slug, signal });
    return state.detailHandler ? state.detailHandler(slug) : Promise.resolve(detailPayload(slug));
  },
}));

function groupPayload(period: SectorPeriod = "1D", prefix = ""): SectorGroupsPayload {
  return {
    classify: "theme",
    period,
    market: "india",
    last_updated: "2026-11-28T00:00:00Z",
    groups: THEME_NAMES.map((name, index) => ({
      name: `${prefix}${name}`,
      change: Number(((index % 2 === 0 ? 1 : -1) * (0.5 + index * 0.1)).toFixed(2)),
      stock_count: 5 + index * 3,
      advances: 3 + index,
      declines: 2 + (index % 3),
      slug: `theme-${index + 1}`,
      near_high_pct: index === 0 ? 58 : index === 1 ? null : 40 + index,
      near_low_pct: index === 0 ? 0 : index === 1 ? null : index % 5,
      median_pos_52w: index === 0 ? 42 : index === 1 ? null : 30 + index,
    })) as SectorGroupsPayload["groups"],
  };
}

function detailPayload(slug: string) {
  return {
    theme: {
      slug,
      name: slug === "theme-1" ? THEME_NAMES[0] : slug,
      category: "Technology",
      description: "Test theme",
      member_count: 3,
    },
    constituents: ["AAA", "BBB", "CCC"],
  };
}

function memberRow(
  symbol: string,
  change: number | null,
  marketCapCr: number | null,
  relativeVolume: number | null,
): MarketRow {
  return {
    symbol,
    name: `${symbol} Full Name`,
    sector: "Technology",
    exchange: "NSE",
    close: 100,
    change,
    relativeVolume,
    marketCapCr,
    capTier: "mid",
    rsi: 50,
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
    fno: false,
    etf: false,
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
  };
}

const quotedRows = () => [
  memberRow("AAA", 3.35, 1000, 3),
  memberRow("BBB", -1.2, 500, null),
  memberRow("CCC", 0.5, 200, 1.4),
];

function renderBoard(
  onSymbolClick = vi.fn(),
  rows: MarketRow[] = [],
  allRows?: MarketRow[],
) {
  renderWithProviders(() => (
    <ThemeBoard rows={rows} allRows={allRows} onSymbolClick={onSymbolClick} />
  ));
  return onSymbolClick;
}

const periodSelect = () =>
  screen.getByTestId("theme-board-period").querySelector("select") as HTMLSelectElement;
const pctOf = (row: HTMLElement): number =>
  Number.parseFloat(row.textContent?.match(/[+-]?\d+\.\d+%/)?.[0] ?? "NaN");

beforeEach(() => {
  viewport.narrow = false;
  state.calls.length = 0;
  state.detailCalls.length = 0;
  state.groupsHandler = (params) =>
    Promise.resolve(
      groupPayload(
        (params.period as SectorPeriod) ?? "1D",
        params.period === "1W" ? "NEW " : "",
      ),
    );
  state.detailHandler = null;
});

afterEach(cleanup);

describe("ThemeBoard — sorted diverging bar chart", () => {
  test("renders 24 rows, every full name, sorted change, zero-centred green/red bars", async () => {
    renderBoard();
    await screen.findByTestId("theme-board");
    const rows = screen.getAllByTestId(/^theme-board-row-/);
    expect(rows).toHaveLength(24);

    // Coverage / truncation proof: every full theme name is present in the DOM,
    // with no ellipsis style or truncate class on any label.
    for (const name of THEME_NAMES) {
      const index = THEME_NAMES.indexOf(name);
      const label = screen.getByTestId(`theme-board-name-theme-${index + 1}`);
      expect(label).toHaveTextContent(name);
      expect(label.className).not.toContain("truncate");
      expect(label.style.getPropertyValue("text-overflow")).not.toBe("ellipsis");
    }

    const breadth = screen.getByTestId("theme-board-breadth-theme-1");
    expect(breadth).toHaveTextContent("H 58% · L 0%");
    expect(breadth).toHaveAttribute("title", "median 42% of 52W range");
    expect(screen.getByTestId("theme-board-breadth-theme-2")).toHaveTextContent("H — · L —");
    expect(screen.getByTestId("theme-board-breadth-theme-2")).toHaveAttribute(
      "title",
      "median — of 52W range",
    );
    expect(rows.every((row) => !row.className.includes("overflow-x"))).toBe(true);

    const changes = rows.map((row) => pctOf(row as HTMLElement));
    expect(changes).toHaveLength(24);
    expect(changes).toEqual([...changes].sort((a, b) => b - a));

    const up = screen.getByTestId("theme-board-bar-theme-1");
    const down = screen.getByTestId("theme-board-bar-theme-2");
    expect(up.style.getPropertyValue("left")).toBe("50%");
    expect(Number.parseFloat(down.style.getPropertyValue("left"))).toBeLessThan(50);
    expect(Number.parseFloat(up.style.getPropertyValue("width"))).toBeGreaterThan(0);
    expect(Number.parseFloat(down.style.getPropertyValue("width"))).toBeGreaterThan(0);
    // Length stays linear in |change|: the 2.8% extreme fills its half-track.
    expect(screen.getByTestId("theme-board-bar-theme-24").style.getPropertyValue("width")).toBe(
      "50.000%",
    );
    expect(Number.parseFloat(up.style.getPropertyValue("width"))).toBeCloseTo(8.929, 2);

    const upRgb = parseColor(up.style.getPropertyValue("background-color"));
    const downRgb = parseColor(down.style.getPropertyValue("background-color"));
    expect(upRgb.g, `gain ${JSON.stringify(upRgb)} must read green`).toBeGreaterThan(upRgb.r);
    expect(downRgb.r, `loss ${JSON.stringify(downRgb)} must read red`).toBeGreaterThan(downRgb.g);

    expect(rows[0]!.getAttribute("title")).toContain("advances");
    expect(rows[0]!.getAttribute("title")).toContain("declines");
    expect(screen.getByTestId("theme-board-legend-text")).toHaveTextContent("loss ← 0 → gain");
    expect(screen.getByTestId("theme-board-asof")).toHaveTextContent("as of 05:30");
  });

  test("changing the period refetches with the new period and renders its payload", async () => {
    renderBoard();
    await screen.findByTestId("theme-board");
    expect(state.calls[0]).toMatchObject({ classify: "theme", period: "1D" });

    fireEvent.input(periodSelect(), { target: { value: "1W" } });
    await vi.waitFor(() => expect(state.calls[1]?.period).toBe("1W"));
    expect(periodSelect().value).toBe("1W");
    expect(screen.getByTestId("theme-board-name-theme-1")).toHaveTextContent("NEW AI Infrastructure");
    expect(state.calls).toHaveLength(2);
  });

  test("detail renders one member tile per quoted member, sorted by change with sign-correct fill and rel vol", async () => {
    renderBoard(vi.fn(), quotedRows());
    await screen.findByTestId("theme-board");
    fireEvent.click(screen.getByTestId("theme-board-row-theme-1"));

    expect(await screen.findByTestId("theme-board-detail")).toBeInTheDocument();
    expect(screen.getByTestId("theme-board-detail-name")).toHaveTextContent("AI Infrastructure");
    expect(screen.getByTestId("theme-board-detail-count")).toHaveTextContent("3 members");
    expect(screen.getByTestId("theme-board-detail-asof")).toHaveTextContent("as of 05:30");
    expect(screen.getByTestId("theme-board-detail-breadth")).toHaveTextContent(
      "H 58% · L 0% · median 42%",
    );
    const tiles = screen.getAllByTestId(/^theme-board-member-[A-Z]/);
    expect(tiles).toHaveLength(3);
    expect(tiles.map((tile) => tile.getAttribute("data-testid"))).toEqual([
      "theme-board-member-AAA",
      "theme-board-member-CCC",
      "theme-board-member-BBB",
    ]);

    const aaa = screen.getByTestId("theme-board-member-AAA");
    expect(aaa).toHaveTextContent("AAA");
    expect(aaa).toHaveTextContent("+3.35%");
    expect(aaa).toHaveTextContent("3.0×");
    expect(aaa.getAttribute("title")).toContain("AAA Full Name");
    expect(aaa.getAttribute("title")).toContain("AI Infrastructure");
    expect(aaa.getAttribute("title")).toContain("rel vol 3.0×");

    // Mid-ramp fills need a scrim so VIZ_TEXT always clears 4.5:1.
    const scrim = screen.getByTestId("theme-board-member-label-AAA");
    expect(scrim.style.getPropertyValue("background-color")).toBe(alpha(VIZ_BG, 0.62));
    expect(scrim.style.getPropertyValue("border-radius")).toBe("3px");
    expect(scrim.style.getPropertyValue("padding")).toBe("1px 3px");
    for (const span of Array.from(scrim.querySelectorAll("span"))) {
      expect(parseColor(span.style.color)).toEqual(parseColor(VIZ_TEXT));
    }

    const bbb = screen.getByTestId("theme-board-member-BBB");
    expect(bbb).toHaveTextContent("—");
    expect(bbb.getAttribute("title")).toContain("rel vol n/a");
    // Member tiles share the bar board's zero-centred P&L scale.
    const lowFill = parseColor(bbb.style.getPropertyValue("background-color"));
    const highFill = parseColor(aaa.style.getPropertyValue("background-color"));
    expect(highFill.g).toBeGreaterThan(highFill.r);
    expect(lowFill.r).toBeGreaterThan(lowFill.g);
    const legend = screen.getByTestId("theme-board-member-scale-note");
    expect(legend).toHaveTextContent("loss ← 0 → gain");
    expect(legend).not.toHaveTextContent("not gain/loss");
    const tilesBox = screen.getByTestId("theme-board-member-tiles");
    expect(tilesBox.className).toContain("grid");
    expect(tilesBox.className).toContain("flex-1");
    expect(tilesBox.className).not.toContain("max-h-");
    expect(tilesBox.className).not.toContain("overflow-auto");
    expect(tilesBox.style.getPropertyValue("grid-auto-rows")).toContain("60px");
    expect(state.detailCalls[0]?.slug).toBe("theme-1");
    expect(screen.queryByTestId("theme-board-no-quote")).not.toBeInTheDocument();
  });

  test("detail breadth shows dashes for null 52W metrics", async () => {
    renderBoard();
    await screen.findByTestId("theme-board");
    fireEvent.click(screen.getByTestId("theme-board-row-theme-2"));
    await screen.findByTestId("theme-board-detail");
    const breadth = screen.getByTestId("theme-board-detail-breadth");
    expect(breadth).toHaveTextContent("H — · L — · median —");
    expect(breadth).not.toHaveTextContent("NaN");
  });

  test("clicking a member tile forwards the symbol to onSymbolClick", async () => {
    const onSymbolClick = renderBoard(vi.fn(), quotedRows());
    await screen.findByTestId("theme-board");
    fireEvent.click(screen.getByTestId("theme-board-row-theme-1"));
    const tile = await screen.findByTestId("theme-board-member-AAA");
    fireEvent.click(tile);
    expect(onSymbolClick).toHaveBeenCalledTimes(1);
    expect(onSymbolClick).toHaveBeenCalledWith("AAA");
  });

  test("closing the detail returns to the chart without refetching", async () => {
    renderBoard();
    await screen.findByTestId("theme-board");
    fireEvent.click(screen.getByTestId("theme-board-row-theme-1"));
    await screen.findByTestId("theme-board-detail");
    fireEvent.click(screen.getByTestId("theme-board-detail-close"));
    expect(await screen.findByTestId("theme-board")).toBeInTheDocument();
    expect(screen.queryByTestId("theme-board-detail")).not.toBeInTheDocument();
    expect(state.calls).toHaveLength(1);
  });

  test("an error shows its message and retry recovers the chart", async () => {
    state.groupsHandler = () => Promise.reject(new Error("theme feed down"));
    renderBoard();
    const error = await screen.findByTestId("theme-board-error");
    expect(error).toHaveTextContent("theme feed down");

    state.groupsHandler = () => Promise.resolve(groupPayload());
    fireEvent.click(screen.getByTestId("theme-board-retry"));
    expect(await screen.findByTestId("theme-board")).toBeInTheDocument();
    expect(screen.queryByTestId("theme-board-error")).not.toBeInTheDocument();
  });

  test("a late response from an older period never overwrites the newer one", async () => {
    const slow = deferred<SectorGroupsPayload>();
    const fast = deferred<SectorGroupsPayload>();
    state.groupsHandler = (params) => (params.period === "1D" ? slow.promise : fast.promise);
    renderBoard();
    await vi.waitFor(() => expect(state.calls).toHaveLength(1));
    expect(screen.getByTestId("theme-board-loading")).toBeInTheDocument();

    fireEvent.input(periodSelect(), { target: { value: "1W" } });
    await vi.waitFor(() => expect(state.calls).toHaveLength(2));
    expect(state.calls[0]!.signal!.aborted).toBe(true);

    fast.resolve(groupPayload("1W", "NEW "));
    await vi.waitFor(() =>
      expect(screen.getByTestId("theme-board-name-theme-1")).toHaveTextContent("NEW AI Infrastructure"),
    );
    slow.resolve(groupPayload("1D", "OLD "));
    await flush();

    expect(screen.getByTestId("theme-board-name-theme-1")).toHaveTextContent("NEW AI Infrastructure");
    expect(screen.queryByText("OLD AI Infrastructure")).not.toBeInTheDocument();
  });

  test("an in-flight request is aborted on unmount", async () => {
    const pending = deferred<SectorGroupsPayload>();
    state.groupsHandler = () => pending.promise;
    renderBoard();
    await vi.waitFor(() => expect(state.calls).toHaveLength(1));
    cleanup();
    expect(state.calls[0]!.signal!.aborted).toBe(true);
    pending.resolve(groupPayload());
    await flush();
    expect(screen.queryByTestId("theme-board")).not.toBeInTheDocument();
  });

  test("shows a visible skeleton list while loading and an explicit empty state", async () => {
    const pending = deferred<SectorGroupsPayload>();
    state.groupsHandler = () => pending.promise;
    renderBoard();
    const skeleton = screen.getByTestId("theme-board-loading");
    expect(skeleton.children.length).toBe(12);
    cleanup();

    state.groupsHandler = () => Promise.resolve({ ...groupPayload(), groups: [] });
    renderBoard();
    expect(await screen.findByTestId("theme-board-empty")).toHaveTextContent("No themes");
  });

  test("groups without a slug render non-clickable rows that never fetch detail", async () => {
    const base = groupPayload().groups[0]!;
    const nullSlug = { ...base, name: "Null Slug Theme", stock_count: 20, slug: null };
    const { slug: _omitted, ...absentSlug } = {
      ...base,
      name: "Absent Slug Theme",
      stock_count: 10,
    };
    state.groupsHandler = () =>
      Promise.resolve({ ...groupPayload(), groups: [nullSlug, absentSlug] });

    renderBoard();
    await screen.findByTestId("theme-board");
    const rows = ["no-slug-0", "no-slug-1"].map((key) =>
      screen.getByTestId(`theme-board-row-${key}`),
    );
    // Both changes tie, so name ordering puts "Absent" first.
    expect(rows[0]).toHaveTextContent("Absent Slug Theme");
    expect(rows[1]).toHaveTextContent("Null Slug Theme");

    for (const row of rows) {
      expect(row.tagName).toBe("DIV");
      expect(row).not.toHaveAttribute("role");
      expect(row).not.toHaveAttribute("tabindex");
      expect(row).not.toHaveAttribute("aria-label");
      expect(row.className).toContain("cursor-default");
      expect(row.className).not.toContain("cursor-pointer");
      fireEvent.click(row);
    }

    expect(state.detailCalls).toHaveLength(0);
    expect(screen.queryByTestId("theme-board-detail")).not.toBeInTheDocument();
  });

  test("member heatmap appears once a delayed theme-detail response resolves", async () => {
    const detail = deferred<ReturnType<typeof detailPayload>>();
    state.detailHandler = () => detail.promise;
    renderBoard(vi.fn(), quotedRows());
    await screen.findByTestId("theme-board");
    fireEvent.click(screen.getByTestId("theme-board-row-theme-1"));
    expect(await screen.findByTestId("theme-board-detail-loading")).toBeInTheDocument();

    detail.resolve(detailPayload("theme-1"));
    const heatmap = await screen.findByTestId("theme-board-member-heatmap");
    expect(heatmap).toBeInTheDocument();
    expect(screen.getAllByTestId(/^theme-board-member-[A-Z]/)).toHaveLength(3);
    expect(screen.queryByTestId("theme-board-detail-loading")).not.toBeInTheDocument();
  });

  test("member fills are zero-centred: +1.4% green, -1.4% red, ~0 neutral", async () => {
    state.detailHandler = () =>
      Promise.resolve({
        ...detailPayload("theme-1"),
        constituents: ["UP", "DOWN", "FLAT"],
      });
    renderBoard(vi.fn(), [
      memberRow("UP", 1.4, 100, 1),
      memberRow("DOWN", -1.4, 100, 1),
      memberRow("FLAT", 0, 100, 1),
    ]);
    await screen.findByTestId("theme-board");
    fireEvent.click(screen.getByTestId("theme-board-row-theme-1"));
    await screen.findByTestId("theme-board-member-heatmap");

    const up = parseColor(screen.getByTestId("theme-board-member-UP").style.getPropertyValue("background-color"));
    const down = parseColor(screen.getByTestId("theme-board-member-DOWN").style.getPropertyValue("background-color"));
    const flat = parseColor(screen.getByTestId("theme-board-member-FLAT").style.getPropertyValue("background-color"));
    expect(up).toEqual(parseColor(marketTileColor(1.4, -1.4, 1.4)));
    expect(up.g).toBeGreaterThan(up.r);
    expect(down.r).toBeGreaterThan(down.g);
    expect(Math.abs(flat.r - flat.g)).toBeLessThan(12);
    expect(screen.getByTestId("theme-board-member-scale-note")).toHaveTextContent("loss ← 0 → gain");
  });

  test("sqrt red-green ramp keeps small gains green beside a 15% extreme", async () => {
    state.detailHandler = () =>
      Promise.resolve({
        ...detailPayload("theme-1"),
        constituents: ["MAX", "UP", "SMALL", "DOWN", "FLAT"],
      });
    renderBoard(vi.fn(), [
      memberRow("MAX", 15, 100, 1),
      memberRow("UP", 1.4, 100, 1),
      memberRow("SMALL", 0.5, 100, 1),
      memberRow("DOWN", -0.8, 100, 1),
      memberRow("FLAT", 0, 100, 1),
    ]);
    await screen.findByTestId("theme-board");
    fireEvent.click(screen.getByTestId("theme-board-row-theme-1"));
    await screen.findByTestId("theme-board-member-heatmap");

    const rgb = (symbol: string) =>
      parseColor(screen.getByTestId(`theme-board-member-${symbol}`).style.getPropertyValue("background-color"));
    const up = rgb("UP");
    const small = rgb("SMALL");
    const down = rgb("DOWN");
    const flat = rgb("FLAT");
    expect(up.g).toBeGreaterThan(up.r);
    expect(small.g).toBeGreaterThan(small.r);
    expect(small.r).toBeLessThan(small.g);
    expect(down.r).toBeGreaterThan(down.g);
    expect(Math.abs(flat.r - flat.g)).toBeLessThan(12);
    expect(rgb("MAX")).toEqual(parseColor(marketTileColor(15, -15, 15)));
    expect(screen.getByTestId("theme-board-member-scale-note")).toHaveTextContent(
      "loss ← 0 → gain",
    );
    expect(screen.getByTestId("theme-board-member-scale-note")).not.toHaveTextContent(
      "not gain/loss",
    );
  });

  test("desktop member grid is uniform two columns with wrapping labels", async () => {
    const symbols = Array.from({ length: 13 }, (_, index) => `M${String(index).padStart(2, "0")}`);
    state.detailHandler = () =>
      Promise.resolve({ ...detailPayload("theme-1"), constituents: symbols });
    renderBoard(
      vi.fn(),
      symbols.map((symbol, index) => memberRow(symbol, index - 6, 10 * (index + 1), 1)),
    );
    await screen.findByTestId("theme-board");
    fireEvent.click(screen.getByTestId("theme-board-row-theme-1"));

    expect(await screen.findByTestId("theme-board-member-heatmap")).toBeInTheDocument();
    const tiles = screen.getAllByTestId(/^theme-board-member-[A-Z]/);
    expect(tiles).toHaveLength(13);
    const grid = screen.getByTestId("theme-board-member-tiles");
    expect(grid.className).toContain("grid-cols-2");
    expect(grid.className).not.toContain("grid-cols-3");
    expect(grid.className).not.toContain("max-h-");
    expect(grid.className).not.toContain("overflow-auto");
    expect(grid.style.getPropertyValue("grid-auto-rows")).toContain("60px");
    expect(tiles.every((tile) => tile.style.getPropertyValue("grid-column") === "")).toBe(true);
    for (const tile of tiles) {
      for (const span of Array.from(tile.querySelectorAll("span"))) {
        expect(span.className).not.toContain("whitespace-nowrap");
        expect(span.className).toContain("overflow-hidden");
        expect(span.className).toContain("break-words");
      }
    }
    expect(screen.getByTestId("theme-board-relvol-note")).toHaveTextContent("× = rel vol");
  });

  test("selecting a theme moves focus to the All themes control", async () => {
    renderBoard(vi.fn(), quotedRows());
    await screen.findByTestId("theme-board");
    expect(screen.queryByTestId("theme-board-detail-close")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("theme-board-row-theme-1"));
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("theme-board-detail-close")),
    );
  });

  test("narrow detail card sizes to all 13 members with no nested scroll", async () => {
    viewport.narrow = true;
    const symbols = Array.from({ length: 13 }, (_, index) => `M${String(index).padStart(2, "0")}`);
    state.detailHandler = () =>
      Promise.resolve({ ...detailPayload("theme-1"), constituents: symbols });
    renderBoard(
      vi.fn(),
      symbols.map((symbol, index) => memberRow(symbol, index - 6, 100 + index, 1)),
    );
    await screen.findByTestId("theme-board");
    fireEvent.click(screen.getByTestId("theme-board-row-theme-1"));

    const card = await screen.findByTestId("theme-board-detail-card");
    expect(card.className).not.toContain("max-h-[45vh]");
    expect(card.className).not.toContain("overflow-auto");
    expect(screen.getByTestId("theme-board-detail").className).not.toContain("overflow-auto");
    const tiles = screen.getAllByTestId(/^theme-board-member-[A-Z]/);
    expect(tiles).toHaveLength(13);
    const grid = screen.getByTestId("theme-board-member-tiles");
    expect(grid.className).toContain("grid-cols-3");
    expect(grid.className).not.toContain("grid-cols-2");
    expect(grid.className).not.toContain("max-h-");
    expect(grid.className).not.toContain("overflow-auto");
    expect(grid.style.getPropertyValue("grid-auto-rows")).toContain("44px");
    expect(tiles.every((tile) => tile.className.includes("min-h-[44px]"))).toBe(true);
    expect(tiles.every((tile) => tile.style.getPropertyValue("grid-column") === "")).toBe(true);
  });

  test("constituents without a quote appear in a muted no-quote row", async () => {
    renderBoard(vi.fn(), [memberRow("AAA", 1.5, 900, 2.2)]);
    await screen.findByTestId("theme-board");
    fireEvent.click(screen.getByTestId("theme-board-row-theme-1"));
    await screen.findByTestId("theme-board-member-AAA");

    const noQuote = screen.getByTestId("theme-board-no-quote");
    expect(noQuote).toHaveTextContent("no quote: BBB, CCC");
    expect(screen.queryByTestId("theme-board-member-BBB")).not.toBeInTheDocument();
  });

  test("member join uses allRows when a rail filter truncates rows", async () => {
    const symbols = Array.from({ length: 13 }, (_, index) => `M${String(index).padStart(2, "0")}`);
    const all = symbols.map((symbol, index) => memberRow(symbol, index - 6, 100 + index, 1));
    state.detailHandler = () =>
      Promise.resolve({
        ...detailPayload("theme-1"),
        constituents: [...symbols, "ZZZZ"],
      });
    // Only one row survives the rail filter; the unfiltered snapshot has all 13.
    renderBoard(vi.fn(), [all[0]!], all);
    await screen.findByTestId("theme-board");
    fireEvent.click(screen.getByTestId("theme-board-row-theme-1"));

    await screen.findByTestId("theme-board-member-heatmap");
    expect(screen.getAllByTestId(/^theme-board-member-[A-Z]/)).toHaveLength(13);
    const noQuote = screen.getByTestId("theme-board-no-quote");
    expect(noQuote).toHaveTextContent("no quote: ZZZZ");
    expect(noQuote).not.toHaveTextContent("M00");
  });

  test("empty rows and zero constituents produce no NaN geometry", async () => {
    state.detailHandler = () =>
      Promise.resolve({ ...detailPayload("theme-1"), constituents: [] });
    renderBoard();
    await screen.findByTestId("theme-board");
    fireEvent.click(screen.getByTestId("theme-board-row-theme-1"));

    expect(await screen.findByTestId("theme-board-member-heatmap")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^theme-board-member-[A-Z]/)).toHaveLength(0);
    expect(document.body.textContent).not.toContain("NaN");
    expect(document.body.getAttribute("style") ?? "").not.toContain("NaN");
  });

  test("wide layout keeps the chart mounted beside the detail and marks the selection", async () => {
    renderBoard();
    const board = await screen.findByTestId("theme-board");
    fireEvent.click(screen.getByTestId("theme-board-row-theme-1"));

    expect(await screen.findByTestId("theme-board-detail-pane")).toBeInTheDocument();
    expect(screen.getByTestId("theme-board")).toBe(board);
    expect(board).toBeInTheDocument();
    expect(screen.getByTestId("theme-board-count")).toHaveTextContent("24 themes");
    expect(screen.getByTestId("theme-board-row-theme-1").className).toContain("ring-fin-primary");
  });

  test("narrow layout keeps all 24 full names and a row click opens the detail", async () => {
    viewport.narrow = true;
    renderBoard(vi.fn(), quotedRows());
    await screen.findByTestId("theme-board");
    expect(screen.getAllByTestId(/^theme-board-row-/)).toHaveLength(24);
    for (const name of THEME_NAMES) {
      const index = THEME_NAMES.indexOf(name);
      const label = screen.getByTestId(`theme-board-name-theme-${index + 1}`);
      expect(label).toHaveTextContent(name);
      expect(label.className).not.toContain("truncate");
    }
    expect(screen.getByTestId("theme-board-row-theme-1")).toHaveTextContent("+0.50%");
    expect(screen.getByTestId("theme-board-breadth-narrow-theme-1")).toHaveTextContent(
      "H 58% · L 0%",
    );
    expect(screen.queryByTestId("theme-board-breadth-theme-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("theme-board-period")).toBeInTheDocument();

    const board = screen.getByTestId("theme-board");
    fireEvent.click(screen.getByTestId("theme-board-row-theme-1"));
    expect(await screen.findByTestId("theme-board-member-AAA")).toHaveTextContent("3.0×");
    expect(screen.getByTestId("theme-board")).toBe(board);
  });

  test("narrow detail card sits above the chart without unmounting it", async () => {
    viewport.narrow = true;
    renderBoard();
    const board = await screen.findByTestId("theme-board");
    fireEvent.click(screen.getByTestId("theme-board-row-theme-1"));

    const card = await screen.findByTestId("theme-board-detail-card");
    expect(card.nextElementSibling!.contains(board)).toBe(true);
    expect(screen.getByTestId("theme-board")).toBe(board);
    expect(screen.getByTestId("theme-board-row-theme-1").className).toContain("ring-fin-primary");
    fireEvent.click(screen.getByTestId("theme-board-detail-close"));
    expect(screen.queryByTestId("theme-board-detail-card")).not.toBeInTheDocument();
    expect(screen.getByTestId("theme-board")).toBe(board);
  });

  test("narrow footer stacks a nowrap legend above the note; wide footer stays one row", async () => {
    viewport.narrow = true;
    renderBoard();
    await screen.findByTestId("theme-board");
    const narrowFooter = screen.getByTestId("theme-board-legend");
    expect(narrowFooter.className).toContain("flex-col");
    const label = screen.getByTestId("theme-board-legend-text");
    expect(label.className).toContain("text-ui-micro");
    expect(label.className).toContain("whitespace-nowrap");
    expect(label.parentElement!.className).toContain("items-center");
    expect(narrowFooter).toHaveTextContent("bar = 1D change · length = |change|");
    cleanup();

    viewport.narrow = false;
    renderBoard();
    await screen.findByTestId("theme-board");
    const wideFooter = screen.getByTestId("theme-board-legend");
    expect(wideFooter.className).toContain("flex-nowrap");
    expect(wideFooter.className).not.toContain("flex-col");
  });

  test("a poll (rows prop change) does not blur the focused member row", async () => {
    const [rows, setRows] = createSignal<MarketRow[]>(quotedRows());
    renderWithProviders(() => (
      <ThemeBoard rows={rows()} allRows={rows()} onSymbolClick={vi.fn()} />
    ));
    await screen.findByTestId("theme-board");
    fireEvent.click(screen.getByTestId("theme-board-row-theme-1"));

    const member = await screen.findByTestId("theme-board-member-AAA");
    member.focus();
    expect(document.activeElement).toBe(member);

    // A fresh snapshot is what the 5s poll delivers: new objects, same symbols.
    setRows(quotedRows());
    await flush();
    expect(screen.getByTestId("theme-board-member-AAA")).toBe(member);
    expect(document.activeElement).toBe(member);
  });

  test("narrow H/L line titles both breadth and the median it does not show", async () => {
    viewport.narrow = true;
    renderBoard();
    await screen.findByTestId("theme-board");
    const breadth = screen.getByTestId("theme-board-breadth-narrow-theme-1");
    expect(breadth).toHaveTextContent("H 58% · L 0%");
    expect(breadth).toHaveAttribute(
      "title",
      "H 58% · L 0% · median 42% of 52W range",
    );
  });

  test("narrow detail uses a divider and surface step, not a nested bordered card", async () => {
    viewport.narrow = true;
    renderBoard();
    await screen.findByTestId("theme-board");
    fireEvent.click(screen.getByTestId("theme-board-row-theme-1"));
    const card = await screen.findByTestId("theme-board-detail-card");

    expect(card.className.split(/\s+/)).not.toContain("border");
    expect(card.className).toContain("border-t");
    expect(card.className).not.toContain("rounded-fin");
    expect(card.className).not.toContain("m-2");
    expect(card.style.getPropertyValue("background-color")).toBe(VIZ_PANEL);
  });
});
