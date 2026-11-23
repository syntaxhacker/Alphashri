// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import type { ChainLeg, ChainRow } from "@/api/optionsDock";
import { OptionChainTable } from "./OptionChainTable";

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

function leg(overrides: Partial<ChainLeg> = {}): ChainLeg {
  return {
    ltp: 114.4,
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
    instrumentKey: "NSE_FO|CE-24000",
    ...overrides,
  };
}

const ROWS: ChainRow[] = [
  { strike: 24000, ce: leg(), pe: leg({ ltp: 82.9, instrumentKey: "NSE_FO|PE-24000" }) },
];

function renderTable(props: {
  onPick?: (strike: number, type: "CE" | "PE", leg: ChainLeg, side: "buy" | "sell") => void;
  onChart?: (strike: number, type: "CE" | "PE", leg: ChainLeg) => void;
  side?: "CE" | "PE";
  narrow?: boolean;
} = {}) {
  if (props.narrow) narrowViewport();
  return render(() => (
    <UIProvider>
      <OptionChainTable
        rows={ROWS}
        spot={24000}
        side={props.side}
        onPick={props.onPick}
        onChart={props.onChart}
      />
    </UIProvider>
  ));
}

describe("chain columns — per-contract chart action", () => {
  it("renders a chart button beside both LTP cells with a contract-specific label", () => {
    renderTable({ onChart: vi.fn() });

    const ce = screen.getByTestId("options-ce-24000-chart");
    const pe = screen.getByTestId("options-pe-24000-chart");
    expect(ce).toHaveAttribute("aria-label", "View 24000 CE premium chart");
    expect(pe).toHaveAttribute("aria-label", "View 24000 PE premium chart");
    // Native buttons give Enter/Space parity without a synthetic key handler.
    expect(ce.tagName).toBe("BUTTON");
    expect(ce).toHaveAttribute("type", "button");
    expect(ce.querySelector("svg")?.getAttribute("width")).toBe("12");
  });

  it("hands the whole contract to onChart and never adds a leg", () => {
    const onChart = vi.fn();
    const onPick = vi.fn();
    renderTable({ onChart, onPick });

    fireEvent.click(screen.getByTestId("options-ce-24000-chart"));

    expect(onPick).not.toHaveBeenCalled();
    expect(onChart).toHaveBeenCalledTimes(1);
    expect(onChart).toHaveBeenCalledWith(24000, "CE", ROWS[0].ce);
  });

  it("keeps the price button a separate buy/sell pick", () => {
    const onChart = vi.fn();
    const onPick = vi.fn();
    renderTable({ onChart, onPick });

    fireEvent.click(screen.getByTestId("options-pe-24000"));

    expect(onChart).not.toHaveBeenCalled();
    expect(onPick).toHaveBeenCalledWith(24000, "PE", ROWS[0].pe, "buy");
  });

  it("renders no chart button when the dock passes no handler", () => {
    renderTable();
    expect(screen.queryByTestId("options-ce-24000-chart")).not.toBeInTheDocument();
  });

  it("narrow keeps only the active side's chart button", () => {
    renderTable({ onChart: vi.fn(), side: "CE", narrow: true });
    expect(screen.getByTestId("options-ce-24000-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("options-pe-24000-chart")).not.toBeInTheDocument();
    cleanup();

    renderTable({ onChart: vi.fn(), side: "PE", narrow: true });
    expect(screen.getByTestId("options-pe-24000-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("options-ce-24000-chart")).not.toBeInTheDocument();
  });

  it("wide renders CE and PE chart buttons", () => {
    renderTable({ onChart: vi.fn() });
    expect(screen.getAllByTestId(/^options-(ce|pe)-\d+-chart$/)).toHaveLength(2);
  });

  it("keeps the LTP columns wide enough for the value plus the icon", () => {
    renderTable({ onChart: vi.fn() });
    const headers = screen.getAllByRole("columnheader");
    const ltp = headers.filter((header) => header.textContent?.trim() === "LTP");
    expect(ltp).toHaveLength(2);
    for (const header of ltp) expect(header.style.width).toBe("64px");
  });
});

describe("chain columns — type scale and touch targets", () => {
  it("renders chain numerics at 11px/14px with an unpriced label on a missing IV", () => {
    renderTable();
    const cells = within(screen.getByTestId("options-chain-row-24000")).getAllByRole("cell");
    const iv = cells[1].querySelector("span") as HTMLElement;
    expect(iv).toHaveTextContent("—");
    expect(iv.className).toContain("text-[11px]");
    expect(iv.className).toContain("leading-[14px]");
    expect(iv.className).not.toContain("text-[10px]");
    expect(iv).toHaveAttribute("aria-label", "unpriced");
  });

  it("gives the chart button a 20px target while keeping the 12px icon", () => {
    renderTable({ onChart: vi.fn() });
    const ce = screen.getByTestId("options-ce-24000-chart");
    expect(ce.className).toContain("h-5");
    expect(ce.className).toContain("w-5");
    expect(ce.className).not.toContain("h-[14px]");
    expect(ce.querySelector("svg")?.getAttribute("width")).toBe("12");
  });

  it("gaps the LTP price from its chart button by 8px", () => {
    renderTable({ onChart: vi.fn() });
    const price = screen.getByTestId("options-ce-24000");
    expect(price.parentElement?.className).toContain("gap-2");
    expect(price.className).toContain("text-[11px]");
    expect(price.className).not.toContain("text-[10px]");
  });
});
