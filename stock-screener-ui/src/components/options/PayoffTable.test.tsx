// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createSignal } from "solid-js";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import * as palette from "@/ui/palette";
import { compositeOver, contrastRatio, pickTextColor } from "@/utils/contrast";

const { mockBuild } = vi.hoisted(() => ({ mockBuild: vi.fn() }));

vi.mock("@/utils/payoffMatrix", () => ({ buildPayoffTable: mockBuild }));

import { PayoffTable, type PayoffTableProps } from "./PayoffTable";
import {
  BASIS_INTRINSIC,
  buildCellTooltip,
  cellFill,
  EMPTY_TABLE,
  formatCellPnl,
  formatExpiryHead,
  formatStrike,
  INTRINSIC_ONLY_NOTE,
  nearbyLegs,
  PAYOFF_VIEWS,
  rangeToPercent,
  robustDomain,
  UNPRICED_NOTE,
  type PayoffTableCell,
  type PayoffTableExpiry,
  type PayoffTableLeg,
} from "./payoffTableOption";

const EXPIRIES: PayoffTableExpiry[] = [
  { date: "2026-11-27", label: "27 Nov", dte: 4, month: "Nov" },
  { date: "2026-12-04", label: "04 Dec", dte: 11, month: "Dec" },
  { date: "2026-12-11", label: "11 Dec", dte: 18, month: "Dec" },
];

const LEGS: PayoffTableLeg[] = [
  { action: "BUY", opt: "CE", strike: 24000, premium: 120, qty: 1 },
  { action: "SELL", opt: "CE", strike: 24500, premium: 60, qty: 1 },
];

function priced(pnl: number, basis = "intrinsic+time"): PayoffTableCell {
  return { pnl, priced: true, basis };
}

/** 4 strikes × 3 expiries, one genuinely unpriced and one intrinsic-only cell. */
function fixture() {
  return {
    strikes: [
      { strike: 23800, spotPct: -1.7, isAtm: false },
      { strike: 24000, spotPct: -0.8, isAtm: false },
      { strike: 24200, spotPct: 0, isAtm: true },
      { strike: 24500, spotPct: 1.2, isAtm: false },
    ],
    expiries: EXPIRIES,
    cells: [
      [priced(-485), priced(-420), { pnl: null, priced: false, basis: "intrinsic-only" }],
      [priced(0), priced(15), priced(40)],
      [priced(1200), priced(120, "intrinsic-only"), priced(1240)],
      [priced(250), priced(280), priced(310)],
    ],
    spot: 24200,
    kpis: { netDebit: 60, maxProfit: 1200, maxLoss: -485, breakevens: [24060], pop: 0.62 },
  };
}

beforeEach(() => {
  mockBuild.mockReset();
  mockBuild.mockImplementation(() => fixture());
});

afterEach(() => cleanup());

interface Rendered {
  onSelectCell: ReturnType<typeof vi.fn>;
  onRangeChange: ReturnType<typeof vi.fn>;
  onViewChange: ReturnType<typeof vi.fn>;
  container: HTMLElement;
}

function mount(overrides: Partial<PayoffTableProps> = {}): Rendered {
  const onSelectCell = vi.fn();
  const onRangeChange = vi.fn();
  const onViewChange = vi.fn();
  const { container } = render(() => (
    <PayoffTable
      legs={LEGS}
      spot={24200}
      asOf="2026-11-23"
      onSelectCell={onSelectCell}
      onRangeChange={onRangeChange}
      onViewChange={onViewChange}
      {...overrides}
    />
  ));
  return { onSelectCell, onRangeChange, onViewChange, container };
}

describe("PayoffTable — dense grid structure", () => {
  test("renders every strike row and expiry column exactly once", () => {
    mount();
    const table = screen.getByTestId("payoff-table");
    expect(table.querySelectorAll("thead th")).toHaveLength(4);
    expect(table.querySelectorAll("tbody tr")).toHaveLength(4);
    expect(table.querySelectorAll("tbody tr td")).toHaveLength(16);
    expect(within(table).getAllByRole("gridcell")).toHaveLength(12);
  });

  test("prints a STRIKES label row and a two-tier month / weekday-date head", () => {
    mount();
    expect(screen.getByTestId("payoff-strikes-label")).toHaveTextContent("STRIKES");
    const head = screen.getByTestId("payoff-col-head-0");
    expect(head).toHaveTextContent("Nov");
    expect(head).toHaveTextContent("Fri 27 Nov");
    expect(screen.getByTestId("payoff-col-head-1")).toHaveTextContent("Dec");
  });

  test("strike column is left aligned, numeric columns right aligned, first column sticky", () => {
    const { container } = mount();
    const table = screen.getByTestId("payoff-table");
    const first = table.querySelector("tbody tr td:first-child")!;
    const numeric = table.querySelector("tbody tr td:nth-child(2)")!;
    expect(first.className).toContain("text-left");
    expect(numeric.className).toContain("text-right");
    expect(numeric.className).toContain("tabular-nums");
    const css = container.querySelector("style")?.textContent ?? "";
    expect(css).toContain("position: sticky");
    expect(css).toContain("left: 0");
    expect(css).toContain("--tbl-row-h: 27px");
    expect(css).toContain("--tbl-cell-pad: 8px 12px");
    expect(css).toContain("--tbl-fs: 11px");
  });

  test("highlights the ATM row with a dashed rail and shows leg tags at leg strikes", () => {
    mount();
    const atm = screen.getByTestId("payoff-row-24200");
    expect(atm.getAttribute("class")).toContain("payoff-atm-row");
    const rail = screen.getByTestId("payoff-strike-2");
    expect(rail.getAttribute("style") ?? "").toContain("dashed");
    expect(screen.getByTestId("payoff-leg-tags-1")).toHaveTextContent("BUY CE");
    expect(screen.getByTestId("payoff-leg-tags-3")).toHaveTextContent("SELL CE");
    expect(screen.queryByTestId("payoff-leg-tags-2")).toBeNull();
  });
});

describe("PayoffTable — colour, contrast and unpriced cells", () => {
  test("derives the fill from palette tokens and the ink from pickTextColor", () => {
    const data = fixture();
    const domain = robustDomain(data.cells, data.kpis);
    for (const [pnl, token] of [
      [1200, palette.POSITIVE],
      [-485, palette.NEGATIVE],
    ] as const) {
      const fill = cellFill(pnl, domain)!;
      expect(fill.background).toBe(palette.alpha(token, fill.alpha));
      const solid = compositeOver(token, palette.SURFACE, fill.alpha);
      expect(fill.ink).toBe(pickTextColor(solid));
      expect(contrastRatio(fill.ink, solid)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("paints a cell with the derived fill and ink, never a raw colour", () => {
    mount();
    const cell = screen.getByTestId("payoff-cell-2-0");
    const data = fixture();
    const expected = cellFill(1200, robustDomain(data.cells, data.kpis))!;
    const fill = cell.parentElement!.querySelector(".payoff-cell-fill")!;
    expect(fill.getAttribute("style") ?? "").toContain(expected.background);
    expect(cell.getAttribute("style") ?? "").toContain(expected.ink);
    expect(cell).toHaveTextContent("+1.2k");
  });

  test("hatches an unpriced cell with an explicit tooltip and no fabricated P&L", () => {
    mount();
    const cell = screen.getByTestId("payoff-cell-0-2");
    expect(cell).toHaveAttribute("data-priced", "false");
    expect(cell).toHaveTextContent("—");
    expect(cell.getAttribute("title") ?? "").toContain(UNPRICED_NOTE);
    const fill = cell.parentElement!.querySelector(".payoff-cell-fill")!;
    expect(fill.getAttribute("style") ?? "").toContain("repeating-linear-gradient");
  });
});

describe("PayoffTable — full strike labels and legible P&L numbers", () => {
  test("strike is a full Indian-grouped number with the spot-% on a second line", () => {
    mount();
    const label = screen.getByTestId("payoff-strike-0");
    expect(label).toHaveTextContent("23,800");
    expect(label).toHaveTextContent("−1.7%");
    expect(label.textContent).not.toMatch(/\d+\.\dk\b/);
    expect(formatStrike(1420)).toBe("1,420");
    expect(formatStrike(1470)).toBe("1,470");
    expect(formatStrike(24000)).toBe("24,000");
  });

  test("small P&L keeps its decimal; only large P&L is compacted", () => {
    expect(formatCellPnl(-337.5)).toBe("−337.5");
    expect(formatCellPnl(-338)).toBe("−338");
    expect(formatCellPnl(120)).toBe("+120");
    expect(formatCellPnl(1200)).toBe("+1.2k");
    expect(formatCellPnl(3412.5)).toBe("+3.4k");
  });

  test("the bull spread renders a different P&L for each strike row", () => {
    const strikes = [1400, 1420, 1450, 1470, 1500];
    const pnls = [-337.5, -337.5, 1912.5, 3412.5, 3412.5];
    mockBuild.mockImplementation(() => ({
      strikes: strikes.map((strike) => ({
        strike,
        spotPct: Number((((strike - 1423) / 1423) * 100).toFixed(4)),
        isAtm: strike === 1420,
      })),
      expiries: [EXPIRIES[0]],
      cells: pnls.map((pnl) => [priced(pnl, "intrinsic-only")]),
      spot: 1423,
      kpis: { netDebit: 337.5, maxProfit: 3412.5, maxLoss: -337.5, breakevens: [1424.5], pop: null },
    }));
    const legs: PayoffTableLeg[] = [
      { action: "BUY", opt: "CE", strike: 1420, premium: 12.5, qty: 75 },
      { action: "SELL", opt: "CE", strike: 1470, premium: 8, qty: 75 },
    ];
    mount({ spot: 1423, legs });
    const texts = strikes.map((_, i) => screen.getByTestId(`payoff-cell-${i}-0`).textContent ?? "");
    expect(new Set(texts).size).toBeGreaterThan(1);
    expect(screen.getByTestId("payoff-strike-1")).toHaveTextContent("1,420");
    expect(screen.getByTestId("payoff-strike-3")).toHaveTextContent("1,470");
    expect(texts[0]).toBe("−337.5");
    expect(texts[2]).toBe("+1.9k");
    expect(texts[3]).toBe("+3.4k");
    const buildInput = mockBuild.mock.calls[mockBuild.mock.calls.length - 1][0];
    expect(buildInput.spot).toBe(1423);
  });
});

describe("PayoffTable — tooltip copy", () => {
  test("includes strike, spot %, expiry/DTE, P&L, basis and nearby legs", () => {
    const data = fixture();
    const copy = buildCellTooltip({
      strike: 24200,
      spotPct: 0,
      expiry: EXPIRIES[1],
      cell: data.cells[2][1],
      legs: LEGS,
    });
    expect(copy).toContain("Strike 24,200");
    expect(copy).toContain("% from spot 0.0%");
    expect(copy).toContain("04 Dec");
    expect(copy).toContain("2026-12-04");
    expect(copy).toContain("11d");
    expect(copy).toContain("P&L +120");
    expect(copy).toContain(BASIS_INTRINSIC);
    expect(copy).toContain(INTRINSIC_ONLY_NOTE);
    expect(copy).not.toMatch(/undefined|NaN/);

    const atLeg = buildCellTooltip({
      strike: 24000,
      spotPct: -0.8,
      expiry: EXPIRIES[1],
      cell: data.cells[1][1],
      legs: LEGS,
    });
    expect(atLeg).toContain("Legs BUY CE 24,000");
    expect(atLeg).toContain("Basis intrinsic + time value");
    expect(atLeg).not.toMatch(/undefined|NaN/);
  });

  test("the rendered cell carries the same rich tooltip on title and aria-label", () => {
    mount();
    const cell = screen.getByTestId("payoff-cell-2-1");
    expect(cell.getAttribute("title")).toBe(cell.getAttribute("aria-label"));
    expect(cell.getAttribute("title") ?? "").toContain("Basis");
    expect(cell.getAttribute("title") ?? "").toContain("intrinsic only — no IV");
  });

  test("formats the two-tier head deterministically from the ISO date", () => {
    expect(formatExpiryHead(EXPIRIES[0])).toEqual({ month: "Nov", date: "Fri 27 Nov" });
    expect(formatExpiryHead(EXPIRIES[1])).toEqual({ month: "Dec", date: "Fri 04 Dec" });
  });
});

describe("PayoffTable — keyboard, callbacks and safety", () => {
  test("uses a roving tabindex starting at the ATM cell and moves with arrow keys", () => {
    mount();
    const first = screen.getByTestId("payoff-cell-2-0");
    expect(first).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("payoff-cell-0-0")).toHaveAttribute("tabindex", "-1");

    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    const next = screen.getByTestId("payoff-cell-2-1");
    expect(document.activeElement).toBe(next);
    expect(next).toHaveAttribute("tabindex", "0");
    expect(first).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(next, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId("payoff-cell-3-1"));
  });

  test("Enter selects the focused strike / expiry and click selects too", () => {
    const { onSelectCell } = mount();
    const cell = screen.getByTestId("payoff-cell-2-0");
    cell.focus();
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(onSelectCell).toHaveBeenCalledWith(24200, "2026-11-27");

    fireEvent.click(screen.getByTestId("payoff-cell-3-2"));
    expect(onSelectCell).toHaveBeenCalledWith(24500, "2026-12-11");
  });

  test("range slider emits a fraction, IV slider rebuilds the matrix", () => {
    const { onRangeChange } = mount({ rangePct: 8 });
    fireEvent.keyDown(screen.getByTestId("payoff-table-range-max"), { key: "ArrowRight" });
    expect(onRangeChange).toHaveBeenCalledTimes(1);
    expect(onRangeChange.mock.calls[0][0]).toBeCloseTo(0.09, 5);

    fireEvent.keyDown(screen.getByTestId("payoff-table-iv-max"), { key: "ArrowRight" });
    const last = mockBuild.mock.calls[mockBuild.mock.calls.length - 1][0];
    expect(last.iv).toBeCloseTo(0.01, 5);
    expect(last.rangePct).toBeCloseTo(0.09, 5);
  });

  test("bottom tabs are a visual selector that emits the view id", () => {
    const { onViewChange } = mount();
    expect(PAYOFF_VIEWS.map((view) => view.label)).toEqual([
      "Table",
      "Graph",
      "Profit/Loss $",
      "Profit/Loss %",
      "Contract Value",
      "% of Max Risk",
    ]);
    const graph = screen.getByTestId("payoff-view-tab-graph");
    fireEvent.click(graph);
    expect(onViewChange).toHaveBeenCalledWith("graph");
    expect(graph).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("payoff-view-tab-table")).toHaveAttribute("aria-pressed", "false");
  });

  test("renders a safe empty state and never prints undefined or NaN", () => {
    mockBuild.mockImplementation(() => EMPTY_TABLE);
    const { container } = mount();
    expect(screen.getByTestId("payoff-table-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("payoff-table")).toBeNull();
    expect(container.textContent).not.toMatch(/undefined|NaN/);
  });

  test("full fixture contains no undefined or NaN text anywhere", () => {
    const { container } = mount();
    expect(container.textContent).not.toMatch(/undefined|NaN/);
  });

  test("range normalization accepts both fraction and percent input", () => {
    expect(rangeToPercent(0.08)).toBe(8);
    expect(rangeToPercent(12)).toBe(12);
    expect(rangeToPercent(undefined)).toBe(8);
    expect(nearbyLegs(LEGS, 24500)).toHaveLength(1);
  });
});

describe("PayoffTable — value-change flashes", () => {
  const flush = () => Promise.resolve();

  function mountLive() {
    const [pnl, setPnl] = createSignal(1200);
    mockBuild.mockImplementation(() => {
      const data = fixture();
      data.cells[2][0] = priced(pnl());
      return data;
    });
    render(() => <PayoffTable legs={LEGS} spot={24200} asOf="2026-11-23" />);
    return { setPnl };
  }

  const cell = () => screen.getByTestId("payoff-cell-2-0");
  const key = () => cell().getAttribute("data-flash-key");

  test("no flash on first mount: sequence 0 and no flash class", async () => {
    mountLive();
    await flush();
    expect(key()).toBe("0");
    expect(cell().className).not.toContain("value-flash-");
    expect(screen.queryByTestId("payoff-cell-flash-2-0")).toBeNull();
  });

  test("a higher value flashes up and a lower value flashes down, each bumping the sequence", async () => {
    const { setPnl } = mountLive();
    await flush();
    expect(key()).toBe("0");

    setPnl(1500);
    await flush();
    expect(key()).toBe("1");
    expect(cell()).toHaveAttribute("data-flash-direction", "up");
    expect(cell().className).toContain("value-flash-up");
    const overlay = screen.getByTestId("payoff-cell-flash-2-0");
    expect(overlay.className).toContain("value-flash-up");
    expect(overlay).toHaveAttribute("data-flash-key", "1");

    setPnl(900);
    await flush();
    expect(key()).toBe("2");
    expect(cell()).toHaveAttribute("data-flash-direction", "down");
    expect(cell().className).toContain("value-flash-down");
    expect(screen.getByTestId("payoff-cell-flash-2-0")).toHaveAttribute("data-flash-key", "2");
  });

  test("an unchanged value does not bump the sequence or add a flash", async () => {
    const { setPnl } = mountLive();
    await flush();
    setPnl(1500);
    await flush();
    expect(key()).toBe("1");

    setPnl(1500);
    await flush();
    expect(key()).toBe("1");
    expect(screen.getByTestId("payoff-cell-flash-2-0")).toHaveAttribute("data-flash-key", "1");
    expect(cell().className).not.toContain("value-flash-down");
  });

  test("moving only the selection never changes a cell's flash sequence", async () => {
    const { setPnl } = mountLive();
    await flush();
    setPnl(1500);
    await flush();
    expect(key()).toBe("1");
    expect(screen.getByTestId("payoff-cell-2-1")).toHaveAttribute("data-flash-key", "0");

    fireEvent.keyDown(cell(), { key: "ArrowRight" });
    await flush();
    expect(key()).toBe("1");
    expect(screen.getByTestId("payoff-cell-2-1")).toHaveAttribute("data-flash-key", "0");
  });
});
