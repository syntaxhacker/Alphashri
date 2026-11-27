// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { SectionTable, type SectionScanRow } from "./SectionTable";
import * as palette from "@/ui/palette";
import type { SectionDefinition } from "../../state/sections/types";

afterEach(() => cleanup());

const def = (overrides: Partial<SectionDefinition> = {}): SectionDefinition => ({
  id: "momentum-5m",
  name: "Momentum 5m",
  description: "Five-minute momentum",
  concept: "momentum_5m",
  side: "long",
  conditions: [{ metric: "change|5", op: "gt", value: 0 }],
  render: { type: "table", columns: ["symbol", "close", "change|5", "relative_volume_10d_calc"] },
  refreshSec: 60,
  enabled: true,
  pinned: false,
  ...overrides,
});

const rows: SectionScanRow[] = [
  {
    symbol: "RELIANCE",
    name: "Reliance Industries",
    fields: { close: 2981.5, "change|5": 0.84, relative_volume_10d_calc: 1.73 },
    signals: { momentum_5m: true },
  },
  {
    symbol: "TCS",
    name: "Tata Consultancy",
    fields: { close: 4120.25, "change|5": -0.31, relative_volume_10d_calc: 0.92 },
    signals: { momentum_5m: false },
  },
];

const panel = () => screen.getByTestId("section-panel-momentum-5m");
const headers = () =>
  Array.from(panel().querySelectorAll<HTMLElement>("thead th")).map((th) =>
    (th.textContent ?? "").replace(/[▲▼]/g, "").trim(),
  );
const header = (label: string): HTMLElement =>
  Array.from(panel().querySelectorAll<HTMLElement>("thead th")).find((th) =>
    (th.textContent ?? "").includes(label),
  )!;

describe("SectionTable — full state", () => {
  it("renders every supplied row with its real field values", () => {
    render(() => <SectionTable section={def()} rows={rows} />);
    expect(within(panel()).getByTestId("section-symbol-RELIANCE")).toHaveTextContent("RELIANCE");
    expect(within(panel()).getByText("Reliance Industries")).toBeInTheDocument();
    expect(within(panel()).getByText("+0.84%")).toBeInTheDocument();
    expect(within(panel()).getByText("1.73×")).toBeInTheDocument();
    expect(document.querySelectorAll("tbody tr[data-row='stock']")).toHaveLength(2);
    expect(document.querySelector("[data-section-state]")).toBeNull();
  });

  it("derives the column set from render.columns plus symbol/name, never a second vocabulary", () => {
    render(() => <SectionTable section={def()} rows={rows} />);
    expect(headers()).toEqual(["SYMBOL", "NAME", "LTP", "Δ 5M", "RVOL 10D", "SIGNAL"]);
  });

  it("deduplicates symbol and name when a section lists them in render.columns", () => {
    render(() => (
      <SectionTable
        section={def({ render: { type: "table", columns: ["symbol", "symbol", "name", "close"] } })}
        rows={rows}
      />
    ));
    expect(headers().filter((h) => h === "SYMBOL")).toHaveLength(1);
    expect(headers().filter((h) => h === "NAME")).toHaveLength(1);
  });

  it("omits the signal badge column when no row carries a signal", () => {
    render(() => (
      <SectionTable section={def()} rows={rows.map((row) => ({ ...row, signals: {} }))} />
    ));
    expect(headers()).not.toContain("SIGNAL");
    expect(screen.queryByText("MATCH")).toBeNull();
  });
});

describe("SectionTable — alignment and typography", () => {
  it("aligns text left, numbers right (mono/tabular) and badges centre", () => {
    render(() => <SectionTable section={def()} rows={rows} />);
    expect(header("SYMBOL").style.textAlign).toBe("left");
    expect(header("NAME").style.textAlign).toBe("left");
    expect(header("Δ 5M").style.textAlign).toBe("right");
    expect(header("RVOL 10D").style.textAlign).toBe("right");
    expect(header("SIGNAL").style.textAlign).toBe("center");

    const numericCell = within(panel()).getByText("+0.84%").closest("td")!;
    expect(numericCell.style.textAlign).toBe("right");
    expect(numericCell.className).toContain("font-mono");
    expect(numericCell.className).toContain("tabular-nums");

    const textCell = within(panel()).getByTestId("section-symbol-RELIANCE").closest("td")!;
    expect(textCell.style.textAlign).toBe("left");

    const badgeCell = within(panel()).getByText("MATCH").closest("td")!;
    expect(badgeCell.style.textAlign).toBe("center");
  });

  it("makes sortable headers keyboard-operable", () => {
    render(() => <SectionTable section={def()} rows={rows} />);
    const th = header("Δ 5M");
    expect(th).toHaveAttribute("tabindex", "0");
    expect(th).toHaveAttribute("aria-sort", "none");
    fireEvent.keyDown(th, { key: "Enter" });
    expect(th).toHaveAttribute("aria-sort", "descending");
  });

  it("forwards dense to the shared table and keeps one scrolling primitive", () => {
    render(() => <SectionTable section={def()} rows={rows} dense />);
    expect(document.querySelector("table")!.style.getPropertyValue("--tbl-row-h")).toBe("18px");
    expect(panel().querySelector(".paper-tanstack-scroll")).toBeInTheDocument();
    expect(panel().querySelectorAll(".paper-tanstack-container")).toHaveLength(0);
    expect(panel().querySelectorAll("table")).toHaveLength(1);
  });
});

describe("SectionTable — named states", () => {
  it("shows a named empty state with a one-line reason instead of a blank table", () => {
    render(() => <SectionTable section={def()} rows={[]} />);
    const state = screen.getByTestId("section-table-empty-momentum-5m");
    expect(state).toHaveAttribute("data-section-state", "empty");
    expect(within(state).getByText(/No symbols matched Momentum 5m in the latest scan/)).toBeInTheDocument();
    expect(document.querySelector("table")).toBeNull();
  });

  it("shows a named loading state even when stale rows are supplied", () => {
    render(() => <SectionTable section={def()} rows={rows} loading />);
    const state = screen.getByTestId("section-table-loading-momentum-5m");
    expect(state).toHaveAttribute("data-section-state", "loading");
    expect(within(state).getByText(/Scanning Momentum 5m/)).toBeInTheDocument();
    expect(screen.queryByText("RELIANCE")).toBeNull();
  });

  it("shows a named error state with the failure reason, taking precedence over loading", () => {
    render(() => (
      <SectionTable section={def()} rows={rows} loading error="TradingView scan timed out" />
    ));
    const state = screen.getByTestId("section-table-error-momentum-5m");
    expect(state).toHaveAttribute("data-section-state", "error");
    expect(within(state).getByText("TradingView scan timed out")).toBeInTheDocument();
    expect(screen.queryByText("RELIANCE")).toBeNull();
    expect(screen.queryByTestId("section-table-loading-momentum-5m")).toBeNull();
  });

  it("never fabricates a value for a missing or non-finite field", () => {
    const partial: SectionScanRow[] = [
      {
        symbol: "IDEA",
        name: "Idea Cellular",
        fields: { close: 12.5, "change|5": null, relative_volume_10d_calc: Number.NaN },
        signals: {},
      },
    ];
    render(() => <SectionTable section={def()} rows={partial} />);
    expect(within(panel()).getAllByText("–")).toHaveLength(2);
    expect(within(panel()).queryByText("0")).toBeNull();
    expect(within(panel()).queryByText("NaN")).toBeNull();
    expect(within(panel()).queryByText("undefined")).toBeNull();
  });
});

describe("SectionTable — actionable symbol rows", () => {
  const clickableCell = (onOpenSymbol: (symbol: string) => void): HTMLElement => {
    render(() => <SectionTable section={def()} rows={rows} onOpenSymbol={onOpenSymbol} />);
    return within(panel()).getByTestId("section-symbol-RELIANCE");
  };

  it("turns the symbol into a button target that opens that symbol's chart on click", () => {
    const onOpenSymbol = vi.fn();
    const cell = clickableCell(onOpenSymbol);

    expect(cell).toHaveAttribute("role", "button");
    expect(cell).toHaveAttribute("tabindex", "0");
    expect(cell).toHaveAttribute("title", "Open RELIANCE chart");
    expect(cell).toHaveStyle({ cursor: "pointer" });
    expect(cell.className).toContain("hover:text-fin-primary");

    fireEvent.click(cell);
    expect(onOpenSymbol).toHaveBeenCalledTimes(1);
    expect(onOpenSymbol).toHaveBeenCalledWith("RELIANCE");
  });

  it.each(["Enter", " "])("opens the symbol's chart on %s", (key) => {
    const onOpenSymbol = vi.fn();
    const cell = clickableCell(onOpenSymbol);

    fireEvent.keyDown(cell, { key });
    expect(onOpenSymbol).toHaveBeenCalledTimes(1);
    expect(onOpenSymbol).toHaveBeenCalledWith("RELIANCE");
  });

  it("opens the clicked row's own symbol, not the first row's", () => {
    const onOpenSymbol = vi.fn();
    const cell = clickableCell(onOpenSymbol);

    fireEvent.click(within(panel()).getByTestId("section-symbol-TCS"));
    expect(onOpenSymbol).toHaveBeenCalledTimes(1);
    expect(onOpenSymbol).toHaveBeenCalledWith("TCS");
    expect(cell).toHaveTextContent("RELIANCE");
  });

  it("leaves the symbol cell inert when no handler is supplied", () => {
    render(() => <SectionTable section={def()} rows={rows} />);
    const cell = within(panel()).getByTestId("section-symbol-RELIANCE");

    expect(cell).not.toHaveAttribute("role");
    expect(cell).not.toHaveAttribute("tabindex");
    expect(cell).not.toHaveAttribute("title");
    expect(cell).toHaveStyle({ cursor: "default" });
    expect(cell.className).not.toContain("hover:text-fin-primary");

    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
  });

  it("renders a bare ticker and opens that ticker for a decorated feed symbol", () => {
    const onOpenSymbol = vi.fn();
    const decorated: SectionScanRow[] = [
      { symbol: "NSE:RELIANCE", name: "Reliance Industries", fields: {}, signals: {} },
    ];
    render(() => <SectionTable section={def()} rows={decorated} onOpenSymbol={onOpenSymbol} />);

    const cell = within(panel()).getByTestId("section-symbol-NSE:RELIANCE");
    expect(cell).toHaveTextContent("RELIANCE");
    expect(cell).not.toHaveTextContent("NSE:");
    fireEvent.click(cell);
    expect(onOpenSymbol).toHaveBeenCalledWith("RELIANCE");
  });

  it("strips a Yahoo suffix from a rendered symbol label", () => {
    const decorated: SectionScanRow[] = [
      { symbol: "INFY.NS", name: "Infosys", fields: {}, signals: {} },
    ];
    render(() => <SectionTable section={def()} rows={decorated} />);

    const cell = within(panel()).getByTestId("section-symbol-INFY.NS");
    expect(cell).toHaveTextContent("INFY");
    expect(cell).not.toHaveTextContent(".NS");
  });
});

describe("SectionTable — 390px right-edge wash", () => {
  const VIEWPORT_W = 390;
  const TABLE_MIN_W = 640;
  const FADE_W = 24;
  const CUE_LANE_PX = 16;
  const fadeId = "section-table-edge-fade-momentum-5m";
  const scrollOwnerClasses = /(?:^|\s)overflow-(?:y-)?(?:auto|scroll)(?:\s|$)/;

  /** A real 390px scrollport: the six columns need 640px, so LTP can clip. */
  const narrowViewport = () => {
    render(() => <SectionTable section={def()} rows={rows} />);
    const viewport = panel().querySelector<HTMLElement>(".paper-tanstack-scroll")!;
    Object.defineProperty(viewport, "scrollWidth", { configurable: true, value: TABLE_MIN_W });
    Object.defineProperty(viewport, "clientWidth", { configurable: true, value: VIEWPORT_W });
    return viewport;
  };

  const widths = () =>
    Array.from(panel().querySelectorAll<HTMLElement>("thead th")).map((th) =>
      Number.parseFloat(th.style.width),
    );

  it("masks the scrollport's right edge at rest without muting the single scroll cue", () => {
    const viewport = narrowViewport();
    fireEvent.scroll(viewport); // scrollLeft 0 => still at the left edge

    const fade = within(panel()).getByTestId(fadeId);
    expect(panel()).toHaveAttribute("data-edge-fade", "right");
    expect(fade).toHaveAttribute("aria-hidden", "true");
    expect(fade.className).toContain("pointer-events-none");
    expect(fade.style.pointerEvents).toBe("none");
    expect(fade.style.width).toBe(`${FADE_W}px`);
    expect(fade.style.top).toBe(`${CUE_LANE_PX}px`);
    // Token-derived wash, never a new hex; opaque at the very edge.
    expect(fade.getAttribute("style") ?? "").toContain("linear-gradient(to right");
    expect(fade.getAttribute("style") ?? "").toContain(palette.SURFACE);
  });

  it("shows no half-digit at rest: LTP clears the wash lane and cells ellipsize", () => {
    const viewport = narrowViewport();
    fireEvent.scroll(viewport);

    const [symbolW, nameW, ltpW] = widths();
    // Narrowed leading columns keep LTP's right edge left of the wash lane even
    // after fixed-layout scaling to the 640px minimum table width.
    expect(symbolW).toBeLessThanOrEqual(96);
    expect(nameW).toBeLessThanOrEqual(120);
    const sum = widths().reduce((total, w) => total + w, 0);
    const ltpRightEdge = (symbolW + nameW + ltpW) * (TABLE_MIN_W / sum);
    expect(ltpRightEdge).toBeLessThan(VIEWPORT_W - FADE_W);

    const ltp = within(panel()).getByTestId("section-close-RELIANCE");
    expect(ltp).toHaveTextContent("2981.50");
    const cell = ltp.closest("td")!;
    expect(cell.style.overflow).toBe("hidden");
    expect(cell.style.textOverflow).toBe("ellipsis");
  });

  it("keeps the full LTP value reachable and drops the wash at the scroll end", () => {
    const viewport = narrowViewport();
    fireEvent.scroll(viewport);
    expect(within(panel()).getByTestId(fadeId)).toBeInTheDocument();

    viewport.scrollLeft = TABLE_MIN_W - VIEWPORT_W;
    fireEvent.scroll(viewport);

    expect(panel()).not.toHaveAttribute("data-edge-fade");
    expect(screen.queryByTestId(fadeId)).toBeNull();
    expect(within(panel()).getByTestId("section-close-RELIANCE")).toHaveTextContent("2981.50");
  });

  it("adds no second scroll owner — only the table scrollport scrolls", () => {
    const viewport = narrowViewport();
    fireEvent.scroll(viewport);

    const owners = Array.from(panel().querySelectorAll<HTMLElement>("*")).filter((el) =>
      scrollOwnerClasses.test(el.className),
    );
    expect(owners).toEqual([viewport]);
    expect(within(panel()).getByTestId(fadeId).className).not.toMatch(scrollOwnerClasses);
  });
});
