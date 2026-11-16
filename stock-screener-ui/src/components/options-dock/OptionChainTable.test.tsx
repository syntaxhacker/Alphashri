// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";
import type { ChainLeg, ChainRow } from "@/api/optionsDock";
import {
  CHAIN_SCROLL_SETTLE_MS,
  OptionChainTable,
  centerScrollTop,
} from "./OptionChainTable";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function narrowViewport() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width: 639px"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

const columnIdsOf = () =>
  screen.getAllByRole("columnheader").map((header) => header.id.replace("paper-tanstack-header-", ""));

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

describe("OptionChainTable — sorting", () => {
  const rowOrder = () =>
    Array.from(document.querySelectorAll('[data-testid^="options-chain-row-"]')).map((el) =>
      el.getAttribute("data-testid"),
    );

  it("defaults to the strike ladder, ascending", () => {
    renderTable();
    expect(rowOrder()).toEqual([
      "options-chain-row-23900",
      "options-chain-row-24000",
      "options-chain-row-24100",
    ]);
    const strike = screen.getAllByRole("columnheader").find((h) => h.id.endsWith("strike"))!;
    expect(strike).toHaveAttribute("aria-sort", "ascending");
  });

  it("renders from a controlled sorting prop and reports header clicks", () => {
    const onSortingChange = vi.fn();
    render(() => (
      <UIProvider>
        <OptionChainTable
          rows={ROWS}
          spot={24000}
          sorting={[{ id: "ce_oi", desc: true }]}
          onSortingChange={onSortingChange}
        />
      </UIProvider>
    ));

    // ce OI: 24,100 (12.4M) > 23,900 (5M) > 24,000 (0).
    expect(rowOrder()).toEqual([
      "options-chain-row-24100",
      "options-chain-row-23900",
      "options-chain-row-24000",
    ]);

    const oi = screen.getAllByRole("columnheader").find((h) => h.id.endsWith("ce_oi"))!;
    fireEvent.click(oi);
    expect(onSortingChange).toHaveBeenCalledWith([{ id: "ce_oi", desc: false }]);
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

describe("OptionChainTable — narrow one-sided layout", () => {
  it("renders only the CE side plus the strike below sm", () => {
    narrowViewport();
    render(() => (
      <UIProvider>
        <OptionChainTable rows={ROWS} spot={24000} side="CE" />
      </UIProvider>
    ));

    expect(columnIdsOf()).toEqual(["ce_oi", "ce_iv", "ce_delta", "ce_ltp", "strike"]);
    expect(screen.getByTestId("options-ce-24000")).toBeInTheDocument();
    expect(screen.queryByTestId("options-pe-24000")).not.toBeInTheDocument();
    expect(screen.queryByTestId("options-oi-bar-pe-0")).not.toBeInTheDocument();
    // Switching sides must not disturb the shared row identity or ATM marker.
    expect(screen.getByTestId("options-chain-row-24000")).toBeInTheDocument();
    expect(screen.getByTestId("options-atm-marker-24000")).toBeInTheDocument();
  });

  it("renders only the strike plus the PE side, keeping the mirror order", () => {
    narrowViewport();
    render(() => (
      <UIProvider>
        <OptionChainTable rows={ROWS} spot={24000} side="PE" />
      </UIProvider>
    ));

    expect(columnIdsOf()).toEqual(["strike", "pe_ltp", "pe_delta", "pe_iv", "pe_oi"]);
    expect(screen.getByTestId("options-pe-24000")).toBeInTheDocument();
    expect(screen.queryByTestId("options-ce-24000")).not.toBeInTheDocument();
    expect(screen.getByTestId("options-atm-marker-24000")).toBeInTheDocument();
  });

  it("drops the 428px floor so the 5-column table fits a 390px sheet", () => {
    narrowViewport();
    render(() => (
      <UIProvider>
        <OptionChainTable rows={ROWS} spot={24000} side="CE" />
      </UIProvider>
    ));

    const table = screen.getByTestId("options-chain") as HTMLElement;
    expect(table.style.minWidth).toBe("250px");
    expect(table.style.minWidth).not.toBe("428px");
    expect(screen.getByTestId("options-chain-table")).toBeInTheDocument();
  });

  it("keeps all nine columns and the 428px floor at ≥640px even when a side is passed", () => {
    render(() => (
      <UIProvider>
        <OptionChainTable rows={ROWS} spot={24000} side="CE" />
      </UIProvider>
    ));

    expect(columnIdsOf()).toHaveLength(9);
    expect((screen.getByTestId("options-chain") as HTMLElement).style.minWidth).toBe("428px");
    expect(screen.getByTestId("options-ce-24000")).toBeInTheDocument();
    expect(screen.getByTestId("options-pe-24000")).toBeInTheDocument();
  });
});

describe("centerScrollTop — pure helper", () => {
  it("centres a row with the ½-row offset", () => {
    // row 5 of 18px in a 100px viewport: 5*18 + 9 - 50 = 49.
    expect(centerScrollTop(5, 18, 100)).toBe(49);
  });

  it("clamps the first rows to 0 (no negative scroll before the first row)", () => {
    expect(centerScrollTop(0, 18, 200)).toBe(0);
    expect(centerScrollTop(1, 18, 200)).toBe(0);
  });

  it("keeps a row past the viewport at a growing positive offset", () => {
    expect(centerScrollTop(20, 18, 100)).toBe(20 * 18 + 9 - 50);
  });

  it("handles zero rows and a non-finite index", () => {
    expect(centerScrollTop(-1, 18, 200)).toBe(0);
    expect(centerScrollTop(Number.NaN, 18, 200)).toBe(0);
  });

  it("treats a missing viewport as 0 rather than NaN", () => {
    expect(centerScrollTop(3, 18, 0)).toBe(3 * 18 + 9);
  });

  it("guards a non-positive row height", () => {
    expect(centerScrollTop(3, 0, 100)).toBe(0);
  });
});

describe("OptionChainTable — ATM auto-centering", () => {
  const LADDER: ChainRow[] = Array.from({ length: 30 }, (_, i) => row(23000 + i * 100));
  // spot 24000 → ATM strike 24000 at ladder index 10, viewport 120px → top 129.
  const ATM_TOP = centerScrollTop(10, 18, 120);

  let scrollToSpy: ReturnType<typeof vi.fn>;
  let scrollTargets: HTMLElement[];
  let originalScrollTo: PropertyDescriptor | undefined;
  let originalClientHeight: PropertyDescriptor | undefined;

  beforeEach(() => {
    scrollTargets = [];
    scrollToSpy = vi.fn(function (this: HTMLElement) {
      scrollTargets.push(this);
    });
    originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
    originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: scrollToSpy,
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 120,
    });
  });

  afterEach(() => {
    if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
    }
  });

  type HarnessState = {
    rows: ChainRow[];
    spot: number;
    side?: "CE" | "PE";
    expiry?: string | null;
    centerNonce?: number;
  };
  type HarnessCtl = {
    setSpot: (v: number) => void;
    setRows: (v: ChainRow[]) => void;
    setSide: (v: "CE" | "PE") => void;
    setExpiry: (v: string) => void;
    setNonce: (v: number) => void;
  };

  function renderHarness(initial: HarnessState): HarnessCtl {
    let ctl!: HarnessCtl;
    render(() => {
      const [rows, setRows] = createSignal(initial.rows);
      const [spot, setSpot] = createSignal(initial.spot);
      const [side, setSide] = createSignal<"CE" | "PE">(initial.side ?? "CE");
      const [expiry, setExpiry] = createSignal<string | null>(initial.expiry ?? null);
      const [nonce, setNonce] = createSignal(initial.centerNonce ?? 0);
      ctl = { setRows, setSpot, setSide, setExpiry, setNonce };
      return (
        <UIProvider>
          <OptionChainTable
            rows={rows()}
            spot={spot()}
            side={side()}
            expiry={expiry()}
            centerNonce={nonce()}
          />
        </UIProvider>
      );
    });
    return ctl;
  }

  const scrollerOf = () =>
    screen.getByTestId("options-chain").closest(".paper-tanstack-scroll") as HTMLElement;
  const hostOf = () => screen.getByTestId("options-chain-table");
  const waitPastSettle = () => new Promise((resolve) => setTimeout(resolve, CHAIN_SCROLL_SETTLE_MS + 40));

  it("scrolls the chain scroll container (never the page) to the ATM offset on first data", () => {
    renderHarness({ rows: LADDER, spot: 24000 });
    expect(scrollToSpy).toHaveBeenCalledWith({ top: ATM_TOP, behavior: "smooth" });
    expect(scrollTargets[0]).toHaveClass("paper-tanstack-scroll");
  });

  it("recentres when the expiry changes", async () => {
    const ctl = renderHarness({ rows: LADDER, spot: 24000, expiry: "2026-03-26" });
    await waitPastSettle();
    fireEvent.scroll(scrollerOf());
    expect(hostOf()).toHaveAttribute("data-following", "false");

    // Changing expiry swaps the ladder and earns a fresh centre even though the
    // user had scrolled away.
    ctl.setExpiry("2026-04-02");
    await waitFor(() => expect(hostOf()).toHaveAttribute("data-following", "true"));
    expect(scrollToSpy).toHaveBeenCalledWith({ top: ATM_TOP, behavior: "smooth" });
  });

  it("turns follow off on a manual scroll and ignores a following spot tick", async () => {
    const ctl = renderHarness({ rows: LADDER, spot: 24000 });
    expect(hostOf()).toHaveAttribute("data-following", "true");

    await waitPastSettle();
    fireEvent.scroll(scrollerOf());
    expect(hostOf()).toHaveAttribute("data-following", "false");

    scrollToSpy.mockClear();
    ctl.setSpot(23950);
    await waitFor(() => expect(scrollToSpy).not.toHaveBeenCalled());
  });

  it("a nonce bump (Center button) re-enables follow and recentres", async () => {
    const ctl = renderHarness({ rows: LADDER, spot: 24000 });
    await waitPastSettle();
    fireEvent.scroll(scrollerOf());
    expect(hostOf()).toHaveAttribute("data-following", "false");

    scrollToSpy.mockClear();
    ctl.setNonce(1);
    await waitFor(() => expect(hostOf()).toHaveAttribute("data-following", "true"));
    expect(scrollToSpy).toHaveBeenCalledWith({ top: ATM_TOP, behavior: "smooth" });
  });

  it("re-centres on a CE|PE side toggle in the 390px one-sided layout", async () => {
    narrowViewport();
    const ctl = renderHarness({ rows: LADDER, spot: 24000, side: "CE" });
    await waitPastSettle();
    fireEvent.scroll(scrollerOf());
    expect(hostOf()).toHaveAttribute("data-following", "false");

    scrollToSpy.mockClear();
    ctl.setSide("PE");
    await waitFor(() => expect(hostOf()).toHaveAttribute("data-following", "true"));
    expect(scrollToSpy).toHaveBeenCalledWith({ top: ATM_TOP, behavior: "smooth" });
    // The strike ladder is unchanged in narrow mode — only the side columns swapped.
    expect(screen.getByTestId("options-strike-cell-24000")).toBeInTheDocument();
  });
});
