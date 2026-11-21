// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import type { JSX } from "solid-js";
import { SymbolLink } from "./SymbolLink";
import { SymbolDockContext } from "./symbolDockContext";

function r(jsx: JSX.Element) {
  return render(() => <UIProvider>{jsx}</UIProvider>);
}

describe("SymbolLink", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("renders the symbol as a TradingView link", () => {
    r(<SymbolLink symbol="RELIANCE" testId="sym-tv" />);
    const link = screen.getByTestId("sym-tv");
    expect(link).toHaveAttribute(
      "href",
      "https://www.tradingview.com/chart/?symbol=NSE%3ARELIANCE",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveTextContent("RELIANCE");
    // style.css hides `a[href*="tradingview.com"]` unless it carries this class.
    expect(link).toHaveClass("pattern-tv-link");
  });

  test("renders the chart icon by default (app-wide dock)", () => {
    r(<SymbolLink symbol="SBIN" testId="sym-tv" />);
    expect(screen.getByTestId("symbol-chart-SBIN")).toBeInTheDocument();
  });

  test("uses the app-wide dock context when no handler is supplied", async () => {
    const open = vi.fn();
    r(
      <SymbolDockContext.Provider
        value={{ open, preview: vi.fn(), endPreview: vi.fn(), close: vi.fn(), pinned: false, setOutlet: vi.fn() }}
      >
        <SymbolLink symbol="SBIN" testId="sym-tv" chartTestId="sym-chart" />
      </SymbolDockContext.Provider>,
    );
    await fireEvent.click(screen.getByTestId("sym-chart"));
    expect(open).toHaveBeenCalledWith("SBIN");
  });

  test("a US market reaches the dock so the chart icon can route to ?market=usa", async () => {
    const open = vi.fn();
    r(
      <SymbolDockContext.Provider
        value={{ open, preview: vi.fn(), endPreview: vi.fn(), close: vi.fn(), pinned: false, setOutlet: vi.fn() }}
      >
        <SymbolLink symbol="AAPL" market="nasdaq" testId="sym-tv" chartTestId="sym-chart" />
      </SymbolDockContext.Provider>,
    );
    await fireEvent.click(screen.getByTestId("sym-chart"));
    expect(open).toHaveBeenCalledWith("AAPL", "chart", "nasdaq");
  });

  test("a US market preserves dotted symbols like BRK.B", async () => {
    const open = vi.fn();
    r(
      <SymbolDockContext.Provider
        value={{ open, preview: vi.fn(), endPreview: vi.fn(), close: vi.fn(), pinned: false, setOutlet: vi.fn() }}
      >
        <SymbolLink symbol="BRK.B" market="NYSE" testId="sym-tv" chartTestId="sym-chart" />
      </SymbolDockContext.Provider>,
    );
    await fireEvent.click(screen.getByTestId("sym-chart"));
    expect(open).toHaveBeenCalledWith("BRK.B", "chart", "NYSE");
  });

  test("an Indian market keeps the existing dock call shape", async () => {
    const open = vi.fn();
    r(
      <SymbolDockContext.Provider
        value={{ open, preview: vi.fn(), endPreview: vi.fn(), close: vi.fn(), pinned: false, setOutlet: vi.fn() }}
      >
        <SymbolLink symbol="RELIANCE" market="NSE" testId="sym-tv" chartTestId="sym-chart" />
      </SymbolDockContext.Provider>,
    );
    await fireEvent.click(screen.getByTestId("sym-chart"));
    expect(open).toHaveBeenCalledWith("RELIANCE");
  });

  test("the options icon forwards the market as well", async () => {
    const open = vi.fn();
    r(
      <SymbolDockContext.Provider
        value={{ open, preview: vi.fn(), endPreview: vi.fn(), close: vi.fn(), pinned: false, setOutlet: vi.fn() }}
      >
        <SymbolLink symbol="AAPL" market="NASDAQ" testId="sym-tv" />
      </SymbolDockContext.Provider>,
    );
    await fireEvent.click(screen.getByTestId("symbol-options-AAPL"));
    expect(open).toHaveBeenCalledWith("AAPL", "options", "NASDAQ");
  });

  test("chart icon opens the in-app chart and does not follow the link", async () => {
    const onOpen = vi.fn();
    const parent = vi.fn();
    r(
      <div onClick={parent}>
        <SymbolLink symbol="SBIN" testId="sym-tv" chartTestId="sym-chart" onOpen={onOpen} />
      </div>,
    );
    await fireEvent.click(screen.getByTestId("sym-chart"));
    expect(onOpen).toHaveBeenCalledWith("SBIN");
    expect(parent).not.toHaveBeenCalled();
  });

  test("hover fires the preview intent and its end", async () => {
    const onPreview = vi.fn();
    const onPreviewEnd = vi.fn();
    r(
      <SymbolLink
        symbol="SBIN"
        testId="sym-tv"
        onPreview={onPreview}
        onPreviewEnd={onPreviewEnd}
      />,
    );
    await fireEvent.mouseEnter(screen.getByTestId("sym-tv-wrap"));
    expect(onPreview).toHaveBeenCalledWith("SBIN", expect.any(MouseEvent));
    await fireEvent.mouseLeave(screen.getByTestId("sym-tv-wrap"));
    expect(onPreviewEnd).toHaveBeenCalledWith("SBIN");
  });

  test("does not render the copy button by default", () => {
    r(<SymbolLink symbol="RELIANCE" testId="sym-tv" />);
    expect(screen.queryByTestId("symbol-copy-RELIANCE")).toBeNull();
  });

  test("showCopy writes the symbol to the clipboard without following the TV link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    r(<SymbolLink symbol="RELIANCE" showCopy testId="sym-tv" />);

    const copy = screen.getByTestId("symbol-copy-RELIANCE");
    await fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith("RELIANCE");
  });
});

describe("SymbolLink inAppText — symbol body / ↗ inversion", () => {
  test("the symbol body is an in-app button, not a TV link, and fires the handler once", async () => {
    const onOpen = vi.fn();
    const row = vi.fn();
    r(
      <div onClick={row}>
        <SymbolLink symbol="RELIANCE" testId="sym" inAppText onOpen={onOpen} />
      </div>,
    );
    const text = screen.getByTestId("sym");
    expect(text.tagName).toBe("BUTTON");
    expect(text).toHaveAttribute("type", "button");
    expect(text).not.toHaveAttribute("href");
    expect(text).toHaveAccessibleName("Open RELIANCE chart");
    await fireEvent.click(text);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("RELIANCE");
    // The row handler must not also fire — one click, one navigation.
    expect(row).not.toHaveBeenCalled();
  });

  test("onTextClick is the in-app action and wins over onOpen", async () => {
    const onTextClick = vi.fn();
    const onOpen = vi.fn();
    r(
      <SymbolLink
        symbol="RELIANCE"
        testId="sym"
        inAppText
        onTextClick={onTextClick}
        onOpen={onOpen}
      />,
    );
    await fireEvent.click(screen.getByTestId("sym"));
    expect(onTextClick).toHaveBeenCalledWith("RELIANCE", expect.any(MouseEvent));
    expect(onOpen).not.toHaveBeenCalled();
  });

  test("↗ is a real TradingView anchor with an accessible name and stops propagation", async () => {
    const row = vi.fn();
    r(
      <div onClick={row}>
        <SymbolLink symbol="RELIANCE" testId="sym" inAppText onOpen={vi.fn()} />
      </div>,
    );
    const external = screen.getByTestId("symbol-tv-RELIANCE");
    expect(external.tagName).toBe("A");
    expect(external).toHaveAttribute(
      "href",
      "https://www.tradingview.com/chart/?symbol=NSE%3ARELIANCE",
    );
    expect(external).toHaveAttribute("target", "_blank");
    expect(external).toHaveAttribute("rel", "noopener noreferrer");
    expect(external).toHaveAccessibleName("Open RELIANCE on TradingView");
    await fireEvent.click(external);
    expect(row).not.toHaveBeenCalled();
  });
});
