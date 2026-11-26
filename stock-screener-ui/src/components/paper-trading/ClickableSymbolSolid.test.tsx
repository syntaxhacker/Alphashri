// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { ClickableSymbolSolid } from "./ClickableSymbolSolid";

describe("ClickableSymbolSolid canonical symbols", () => {
  let assign: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  });

  afterEach(() => {
    assign.mockRestore();
    cleanup();
  });

  const renderSymbol = (symbol: string, onClick?: (s: string) => void) =>
    render(() => (
      <UIProvider>
        <ClickableSymbolSolid symbol={symbol} onClick={onClick} />
      </UIProvider>
    ));

  it("renders both option encodings as the same normalized label", () => {
    renderSymbol("NIFTY 2026-10-19 22900CE");
    expect(screen.getByTestId("symbol-link-NIFTY 2026-10-19 22900CE")).toHaveTextContent(
      "NIFTY 22900 CE",
    );
    cleanup();
    renderSymbol("NIFTY26OCT22900CE");
    expect(screen.getByTestId("symbol-link-NIFTY26OCT22900CE")).toHaveTextContent(
      "NIFTY 22900 CE",
    );
  });

  it("keeps the raw contract in the tooltip and in the click payload", () => {
    const onClick = vi.fn();
    const raw = "NIFTY26OCT23000PE";
    renderSymbol(raw, onClick);
    const button = screen.getByTestId(`symbol-link-${raw}`);
    expect(button).toHaveAttribute("title", raw);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledWith(raw);
  });

  it("navigates through chartHrefForSymbol with the resolved underlying", () => {
    renderSymbol("NSE:NIFTY26OCT23000PE");
    fireEvent.click(screen.getByTestId("symbol-link-NSE:NIFTY26OCT23000PE"));
    expect(assign).toHaveBeenCalledWith("/chart/NIFTY");
  });

  it("strips exchange decoration on the fallback chart route", () => {
    renderSymbol("NSE:RELIANCE");
    fireEvent.click(screen.getByTestId("symbol-link-NSE:RELIANCE"));
    expect(assign).toHaveBeenCalledWith("/chart/RELIANCE");
  });
});
