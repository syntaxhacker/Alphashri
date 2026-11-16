// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";
import type { ChainLeg, ChainRow } from "@/api/optionsDock";
import { OptionChainTable } from "./OptionChainTable";

afterEach(cleanup);

function leg(overrides: Partial<ChainLeg> = {}): ChainLeg {
  return {
    ltp: 100,
    oi: 0,
    prevOi: 0,
    volume: 0,
    iv: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    pop: null,
    bid: null,
    ask: null,
    instrumentKey: "",
    ...overrides,
  };
}

function row(strike: number, ce: Partial<ChainLeg> = {}, pe: Partial<ChainLeg> = {}): ChainRow {
  return { strike, ce: leg(ce), pe: leg(pe) };
}

const ROWS: ChainRow[] = [
  row(23900, { oi: 5_000_000, iv: 13.9 }),
  row(24000, { oi: 0, iv: null }), // ATM: zero OI, missing IV
  row(24100, { oi: 12_400_000, iv: 13.8 }),
];

function renderTable() {
  return render(() => (
    <UIProvider>
      <OptionChainTable rows={ROWS} spot={24000} />
    </UIProvider>
  ));
}

function renderRows(rows: ChainRow[]) {
  return render(() => (
    <UIProvider>
      <OptionChainTable rows={rows} spot={rows[0].strike} />
    </UIProvider>
  ));
}

const minWidthOf = (el: HTMLElement) => el.style.minWidth || el.style.getPropertyValue("min-width");

const hexToRgb = (hex: string) => {
  const h = hex.replace("#", "");
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
};

describe("OptionChainTable — chain cells", () => {
  it("renders zero OI as 0 and a missing IV as —", () => {
    renderTable();
    const cells = within(screen.getByTestId("options-chain-row-24000")).getAllByRole("cell");
    // Column order: CE OI, CE IV, CE Δ, CE LTP, STRIKE, PE LTP, PE Δ, PE IV, PE OI.
    expect(cells[0].textContent).toBe("0");
    expect(cells[1].textContent).toBe("—");
  });

  it("renders a present OI and IV as numbers, not a dash", () => {
    renderTable();
    const cells = within(screen.getByTestId("options-chain-row-23900")).getAllByRole("cell");
    expect(cells[0].textContent).not.toBe("—");
    expect(cells[1].textContent).toBe("13.9");
  });

  it("marks the ATM strike cell with ◀ and an accessible label", () => {
    renderTable();
    const atmCell = screen.getByTestId("options-strike-cell-24000");
    expect(atmCell.textContent).toContain("◀");
    expect(screen.getByTestId("options-atm-marker-24000")).toHaveAttribute(
      "aria-label",
      "At the money strike 24000",
    );
    // Non-ATM strikes carry the number only.
    expect(screen.getByTestId("options-strike-cell-23900").textContent).not.toContain("◀");
  });

  it("tints the ATM row with a theme token, never a dark literal", () => {
    renderTable();
    const row = screen.getByTestId("options-chain-row-24000");
    expect(row.style.backgroundColor).toBe("var(--atm-tint)");
    const tint = row.style.getPropertyValue("--atm-tint");
    expect(tint.toLowerCase()).toContain("color-mix");
    expect(tint).toContain("var(--color-fin-primary)");
    expect(tint).toContain("var(--color-fin-surface)");
    expect(tint).not.toMatch(/rgba?\(/);
    expect(tint.toLowerCase()).not.toContain("#13161c");
  });

  it("paints OI bars with solid tokens, not the 12% tint alphas", () => {
    renderTable();
    const ceBar = within(screen.getByTestId("options-chain-row-23900")).getByTestId(
      "options-oi-bar-ce-5000000",
    );
    const peBar = within(screen.getByTestId("options-chain-row-24000")).getByTestId(
      "options-oi-bar-pe-0",
    );
    const norm = (s: string) => s.toLowerCase().replace(/\s/g, "");

    expect([palette.OI_CALL.toLowerCase(), hexToRgb(palette.OI_CALL)]).toContain(
      norm(ceBar.style.backgroundColor),
    );
    expect([palette.OI_PUT.toLowerCase(), hexToRgb(palette.OI_PUT)]).toContain(
      norm(peBar.style.backgroundColor),
    );
    // Never the 1.12:1 / 1.18:1 tints that made the bars invisible.
    expect(ceBar.style.backgroundColor).not.toBe(palette.TINT_POSITIVE);
    expect(peBar.style.backgroundColor).not.toBe(palette.TINT_NEGATIVE);
    expect(ceBar.style.backgroundColor).not.toContain("0.12");
    // Width still scales with OI.
    expect(parseFloat(ceBar.style.width)).toBeGreaterThan(parseFloat(peBar.style.width));
  });
});

describe("OptionChainTable — OI bar square-root scale", () => {
  it("scales a 25-of-100 OI to a 50% bar with a 2px floor", () => {
    renderRows([row(100, { oi: 25 }, { oi: 100 })]);
    const bar = screen.getByTestId("options-oi-bar-ce-25");
    // sqrt(25 / 100) = 0.5 — a linear map would give 25%.
    expect(bar.style.width).toBe("50%");
    expect(minWidthOf(bar)).toBe("2px");
  });

  it("keeps a near-zero OI visible — 2px floor, never a 0% invisible bar", () => {
    renderRows([row(100, { oi: 1 }, { oi: 1_000_000 })]);
    const bar = screen.getByTestId("options-oi-bar-ce-1");
    // sqrt(1 / 1_000_000) * 100 = 0.1%, not 0%; min-width supplies the visible tick.
    expect(bar.style.width).not.toBe("0%");
    expect(parseFloat(bar.style.width)).toBeGreaterThan(0);
    expect(minWidthOf(bar)).toBe("2px");
  });
});

describe("OptionChainTable — header affordances", () => {
  it("requests a sticky, keyboard-sortable header", () => {
    renderTable();
    const th = screen.getAllByRole("columnheader")[0] as HTMLElement;
    expect(th.style.position).toBe("sticky");
    expect(th).toHaveAttribute("tabindex", "0");
    expect(th).toHaveAttribute("aria-sort");

    const before = th.getAttribute("aria-sort");
    fireEvent.keyDown(th, { key: "Enter" });
    expect(th.getAttribute("aria-sort")).not.toBe(before);
  });
});
