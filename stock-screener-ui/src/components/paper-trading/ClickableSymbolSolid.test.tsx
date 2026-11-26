// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { UIProvider } from "@/ui";
import { ClickableSymbolSolid } from "./ClickableSymbolSolid";

const dockMock = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  preview: vi.fn(),
  endPreview: vi.fn(),
  setOutlet: vi.fn(),
  mode: vi.fn(() => "chart"),
  symbol: vi.fn(() => null),
  // A mounted provider exposes `mode`/`symbol`; the inert context does not.
  // Toggled off for the no-dock fallback-route cases.
  present: { value: true },
}));

vi.mock("@/components/common/symbolDockContext", async () => {
  const actual = await vi.importActual<typeof import("@/components/common/symbolDockContext")>(
    "@/components/common/symbolDockContext",
  );
  return {
    ...actual,
    useSymbolDock: () => ({
      open: dockMock.open,
      close: dockMock.close,
      preview: dockMock.preview,
      endPreview: dockMock.endPreview,
      setOutlet: dockMock.setOutlet,
      pinned: false,
      ...(dockMock.present.value ? { mode: dockMock.mode, symbol: dockMock.symbol } : {}),
    }),
  };
});

describe("ClickableSymbolSolid", () => {
  let assign: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dockMock.present.value = true;
    assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  });

  afterEach(() => {
    assign.mockRestore();
    cleanup();
    vi.clearAllMocks();
  });

  function mount(symbol: string, onClick?: (symbol: string) => void) {
    return render(() => (
      <UIProvider>
        <ClickableSymbolSolid symbol={symbol} onClick={onClick} />
      </UIProvider>
    ));
  }

  it("renders both option encodings as the same normalized label", () => {
    mount("NIFTY 2026-10-19 22900CE");
    expect(screen.getByTestId("symbol-link-NIFTY 2026-10-19 22900CE")).toHaveTextContent(
      "NIFTY 22900 CE",
    );
    cleanup();
    mount("NIFTY26OCT22900CE");
    expect(screen.getByTestId("symbol-link-NIFTY26OCT22900CE")).toHaveTextContent(
      "NIFTY 22900 CE",
    );
  });

  it("keeps the raw contract in the tooltip and in the click payload", () => {
    const onClick = vi.fn();
    const raw = "NIFTY26OCT23000PE";
    mount(raw, onClick);
    const button = screen.getByTestId(`symbol-link-${raw}`);
    expect(button).toHaveAttribute("title", raw);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledWith(raw);
  });

  it("navigates through chartHrefForSymbol with the resolved underlying", () => {
    dockMock.present.value = false;
    mount("NSE:NIFTY26OCT23000PE");
    fireEvent.click(screen.getByTestId("symbol-link-NSE:NIFTY26OCT23000PE"));
    expect(assign).toHaveBeenCalledWith("/chart/NIFTY");
  });

  it("strips exchange decoration on the fallback chart route", () => {
    dockMock.present.value = false;
    mount("NSE:RELIANCE");
    fireEvent.click(screen.getByTestId("symbol-link-NSE:RELIANCE"));
    expect(assign).toHaveBeenCalledWith("/chart/RELIANCE");
  });

  it("renders a native button with an accessible label and a visible focus ring", () => {
    mount("RELIANCE");
    const button = screen.getByTestId("symbol-link-RELIANCE");
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-label", "Open chart for RELIANCE");
    expect(button.className).toContain("focus-visible:outline");
    expect(button.className).toContain("focus-visible:outline-[var(--color-fin-primary)]");
    expect(button.className).not.toContain("focus:outline-none");
    expect(button).toHaveAttribute("title", "RELIANCE");
  });

  it("opens the app-wide dock on click instead of reloading the page", () => {
    mount("RELIANCE");
    fireEvent.click(screen.getByTestId("symbol-link-RELIANCE"));
    expect(dockMock.open).toHaveBeenCalledTimes(1);
    expect(dockMock.open).toHaveBeenCalledWith("RELIANCE");
    expect(assign).not.toHaveBeenCalled();
  });

  it("resolves a dated option symbol to its underlying before the dock", () => {
    const symbol = "NIFTY 2026-10-19 22900CE";
    mount(symbol);
    fireEvent.click(screen.getByTestId(`symbol-link-${symbol}`));
    expect(dockMock.open).toHaveBeenCalledWith("NIFTY");
    expect(dockMock.open).not.toHaveBeenCalledWith(symbol);
  });

  it("resolves a compact option symbol to its underlying before the dock", () => {
    const symbol = "RELIANCE26OCT3000CE";
    mount(symbol);
    fireEvent.click(screen.getByTestId(`symbol-link-${symbol}`));
    expect(dockMock.open).toHaveBeenCalledWith("RELIANCE");
    expect(dockMock.open).not.toHaveBeenCalledWith(symbol);
  });

  it("keeps an explicit onClick: raw symbol to the caller, never the dock", () => {
    const onClick = vi.fn();
    const parent = vi.fn();
    render(() => (
      <UIProvider>
        <div onClick={parent}>
          <ClickableSymbolSolid symbol="NIFTY 24000 CE" onClick={onClick} />
        </div>
      </UIProvider>
    ));
    fireEvent.click(screen.getByTestId("symbol-link-NIFTY 24000 CE"));
    expect(onClick).toHaveBeenCalledWith("NIFTY 24000 CE");
    expect(dockMock.open).not.toHaveBeenCalled();
    expect(parent).not.toHaveBeenCalled();
  });

  it("no longer contains the old full-page navigation or focus suppression", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/paper-trading/ClickableSymbolSolid.tsx"),
      "utf8",
    );
    expect(source).not.toContain("window.location.assign");
    expect(source).not.toContain("/chart/${");
    expect(source).not.toContain("focus:outline-none");
  });
});
