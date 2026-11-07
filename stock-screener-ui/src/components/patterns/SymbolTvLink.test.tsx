// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import { SymbolTvLink } from "./SymbolTvLink";

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("SymbolTvLink", () => {
  afterEach(() => cleanup());

  test("builds the TradingView URL from the symbol (default NSE market)", () => {
    r(<SymbolTvLink symbol="IRCON" testId="tv-IRCON">IRCON</SymbolTvLink>);

    const link = screen.getByTestId("tv-IRCON");
    expect(link).toHaveAttribute(
      "href",
      "https://www.tradingview.com/chart/?symbol=NSE%3AIRCON",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("aria-label", "Open IRCON on TradingView");
    expect(link).toHaveClass("pattern-tv-link");
    expect(link).toHaveTextContent("IRCON");
  });

  test("maps Indian index symbols to their exchange (SENSEX → BSE)", () => {
    r(<SymbolTvLink symbol="SENSEX" testId="tv-sensex">SENSEX</SymbolTvLink>);

    const link = screen.getByTestId("tv-sensex");
    expect(link).toHaveAttribute(
      "href",
      "https://www.tradingview.com/chart/?symbol=BSE%3ASENSEX",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("renders custom children as the link label", () => {
    r(
      <SymbolTvLink symbol="IRCON" testId="tv-custom">
        <span data-testid="label">Custom Label</span>
      </SymbolTvLink>,
    );
    expect(screen.getByTestId("label")).toHaveTextContent("Custom Label");
    expect(screen.getByTestId("tv-custom")).toHaveTextContent("Custom Label");
  });

  test("clicking the link stops propagation and does not bubble", async () => {
    const parentOnClick = vi.fn();
    r(
      <div data-testid="wrap" onClick={parentOnClick}>
        <SymbolTvLink symbol="NIFTY" testId="tv-nifty">NIFTY</SymbolTvLink>
      </div>,
    );

    await fireEvent.click(screen.getByTestId("tv-nifty"));
    expect(parentOnClick).not.toHaveBeenCalled();
  });
});
