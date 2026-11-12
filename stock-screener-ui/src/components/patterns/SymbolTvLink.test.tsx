// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
vi.mock("@/ui", async (importOriginal) => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  const actual = await importOriginal<typeof import("@/ui")>();
  return mockSolidUi(actual);
});
import { SymbolTvLink } from "./SymbolTvLink";

describe("SymbolTvLink", () => {
  afterEach(() => cleanup());

  test("builds the TradingView URL from the symbol (default NSE market)", () => {
    render(() => <SymbolTvLink symbol="IRCON" testId="tv-IRCON">IRCON</SymbolTvLink>);

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
    render(() => <SymbolTvLink symbol="SENSEX" testId="tv-sensex">SENSEX</SymbolTvLink>);

    const link = screen.getByTestId("tv-sensex");
    expect(link).toHaveAttribute(
      "href",
      "https://www.tradingview.com/chart/?symbol=BSE%3ASENSEX",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("renders custom children as the link label", () => {
    render(() => <SymbolTvLink symbol="IRCON" testId="tv-custom">
        <span data-testid="label">Custom Label</span>
      </SymbolTvLink>);
    expect(screen.getByTestId("label")).toHaveTextContent("Custom Label");
    expect(screen.getByTestId("tv-custom")).toHaveTextContent("Custom Label");
  });

  test("clicking the link stops propagation and does not bubble", async () => {
    const parentOnClick = vi.fn();
    render(() => <div data-testid="wrap" onClick={parentOnClick}>
        <SymbolTvLink symbol="NIFTY" testId="tv-nifty">NIFTY</SymbolTvLink>
      </div>);

    await fireEvent.click(screen.getByTestId("tv-nifty"));
    expect(parentOnClick).not.toHaveBeenCalled();
  });
});
