// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import { SymbolLink } from "./SymbolLink";
import { SymbolDockContext } from "./symbolDockContext";

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("SymbolLink", () => {
  afterEach(() => cleanup());

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

  test("uses an explicit market for non-Indian listings", () => {
    r(<SymbolLink symbol="AAPL" market="NASDAQ" testId="sym-tv" />);
    expect(screen.getByTestId("sym-tv")).toHaveAttribute(
      "href",
      "https://www.tradingview.com/chart/?symbol=NASDAQ%3AAAPL",
    );
  });

  test("renders the chart icon by default (app-wide dock)", () => {
    r(<SymbolLink symbol="SBIN" testId="sym-tv" />);
    expect(screen.getByTestId("symbol-chart-SBIN")).toBeInTheDocument();
  });

  test("uses the app-wide dock context when no handler is supplied", async () => {
    const open = vi.fn();
    r(
      <SymbolDockContext.Provider
        value={{ open, preview: vi.fn(), endPreview: vi.fn(), close: vi.fn(), pinned: false }}
      >
        <SymbolLink symbol="SBIN" testId="sym-tv" chartTestId="sym-chart" />
      </SymbolDockContext.Provider>,
    );
    await userEvent.click(screen.getByTestId("sym-chart"));
    expect(open).toHaveBeenCalledWith("SBIN");
  });

  test("chart icon opens the in-app chart and does not follow the link", async () => {
    const onOpen = vi.fn();
    const parent = vi.fn();
    r(
      <div onClick={parent}>
        <SymbolLink symbol="SBIN" testId="sym-tv" chartTestId="sym-chart" onOpen={onOpen} />
      </div>,
    );
    await userEvent.click(screen.getByTestId("sym-chart"));
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
    await userEvent.hover(screen.getByTestId("sym-tv-wrap"));
    expect(onPreview).toHaveBeenCalledWith("SBIN");
    await userEvent.unhover(screen.getByTestId("sym-tv-wrap"));
    expect(onPreviewEnd).toHaveBeenCalledWith("SBIN");
  });

  test("keeps the text plain when the TV link is disabled", () => {
    r(<SymbolLink symbol="NIFTY" testId="sym-plain" tvLink={false} />);
    expect(screen.getByTestId("sym-plain").tagName).not.toBe("A");
  });
});
