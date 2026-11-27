// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { SectorTable } from "./SectorTable";
import { IntervalMoversTable } from "./IntervalMoversTable";
import type { SectorItem } from "../../types/sector";
import type { InternalStockMover } from "./sectorUtils";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  return writeText;
}

const sector: SectorItem[] = [
  {
    sector: "IT",
    avg_change: 1,
    stock_count: 2,
    advances: 2,
    declines: 0,
    avg_rsi: 55,
    avg_adx: 26,
    top_movers: "NSE:RELIANCE",
  },
];

describe("sector symbol copy actions", () => {
  it("copies the display symbol from a sector top-mover row without opening the chart", async () => {
    const writeText = stubClipboard();
    const onSymbolClick = vi.fn();
    render(() => <SectorTable sectors={sector} onSymbolClick={onSymbolClick} />);

    const text = screen.getByTestId("sector-top-mover-NSE:RELIANCE");
    expect(text).toHaveTextContent("RELIANCE");
    const copy = screen.getByTestId("symbol-copy-RELIANCE");
    expect(copy).toHaveAttribute("aria-label", "Copy RELIANCE");

    await fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith("RELIANCE");
    expect(onSymbolClick).not.toHaveBeenCalled();
  });

  it("copies a plain interval mover without opening the chart", async () => {
    const writeText = stubClipboard();
    const onSymbolClick = vi.fn();
    const movers: InternalStockMover[] = [
      { symbol: "TCS", change: 1, prev_change: 0.5, delta: 0.5 },
    ];
    render(() => (
      <IntervalMoversTable movers={movers} onSymbolClick={onSymbolClick} />
    ));

    const copy = screen.getByTestId("symbol-copy-TCS");
    expect(copy).toHaveAttribute("aria-label", "Copy TCS");
    await fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith("TCS");
    expect(onSymbolClick).not.toHaveBeenCalled();
  });

  it("copies the display symbol beside a canonical interval-mover link", async () => {
    const writeText = stubClipboard();
    const onSymbolClick = vi.fn();
    const movers: InternalStockMover[] = [
      { symbol: "NSE:RELIANCE", change: 1, prev_change: 0.5, delta: 0.5 },
    ];
    render(() => (
      <IntervalMoversTable movers={movers} onSymbolClick={onSymbolClick} />
    ));

    const link = screen.getByTestId("interval-mover-NSE:RELIANCE");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/chart/RELIANCE");
    const copy = screen.getByTestId("copy-symbol-RELIANCE");
    expect(copy).toHaveAttribute("aria-label", "Copy RELIANCE");

    await fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith("RELIANCE");
    expect(onSymbolClick).not.toHaveBeenCalled();
    fireEvent.keyDown(link, { key: " " });
    expect(onSymbolClick).not.toHaveBeenCalled();
  });
});
