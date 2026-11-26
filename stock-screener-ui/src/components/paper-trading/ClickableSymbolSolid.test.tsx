// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ClickableSymbolSolid } from "./ClickableSymbolSolid";

const dockMock = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  preview: vi.fn(),
  endPreview: vi.fn(),
  setOutlet: vi.fn(),
}));

vi.mock("@/components/common/symbolDockContext", () => ({
  useSymbolDock: () => ({ ...dockMock, pinned: false }),
}));

afterEach(() => {
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

describe("ClickableSymbolSolid", () => {
  it("renders a native button with an accessible label and a visible focus ring", () => {
    mount("RELIANCE");
    const button = screen.getByTestId("symbol-link-RELIANCE");
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-label", "Open chart for RELIANCE");
    expect(button.className).toContain("focus-visible:outline");
    expect(button.className).toContain("focus-visible:outline-[var(--color-fin-primary)]");
    expect(button.className).not.toContain("focus:outline-none");
  });

  it("opens the app-wide dock on click instead of reloading the page", () => {
    mount("RELIANCE");
    fireEvent.click(screen.getByTestId("symbol-link-RELIANCE"));
    expect(dockMock.open).toHaveBeenCalledTimes(1);
    expect(dockMock.open).toHaveBeenCalledWith("RELIANCE");
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
