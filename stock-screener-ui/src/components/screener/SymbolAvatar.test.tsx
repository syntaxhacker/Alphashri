// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import type { ReactElement } from "react";

import { SymbolAvatar } from "./SymbolAvatar";

const renderWithProvider = (ui: ReactElement) => render(<UIProvider>{ui}</UIProvider>);

describe("SymbolAvatar", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the logo image when a logo is provided", () => {
    renderWithProvider(<SymbolAvatar symbol="INDIAGLYCO" logo="https://example.com/logo.svg" />);
    const avatar = screen.getByTestId("symbol-avatar");
    expect(avatar).toHaveAttribute("data-symbol", "INDIAGLYCO");
    const img = avatar.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("alt", "INDIAGLYCO");
    expect(img).toHaveAttribute("src", "https://example.com/logo.svg");
  });

  it("falls back to initials when logo is null", () => {
    renderWithProvider(<SymbolAvatar symbol="RELIANCE" logo={null} />);
    const avatar = screen.getByTestId("symbol-avatar");
    expect(avatar).toHaveAttribute("data-fallback", "initials");
    expect(avatar).toHaveTextContent("RE");
    expect(avatar.querySelector("img")).toBeNull();
  });

  it("falls back to initials when the logo image errors", () => {
    renderWithProvider(<SymbolAvatar symbol="INFY" logo="https://example.com/broken.svg" />);
    const avatar = screen.getByTestId("symbol-avatar");
    const img = avatar.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img as Element);
    expect(screen.getByTestId("symbol-avatar")).toHaveAttribute("data-fallback", "initials");
    expect(screen.getByTestId("symbol-avatar")).toHaveTextContent("IN");
    expect(screen.getByTestId("symbol-avatar").querySelector("img")).toBeNull();
  });

  it("respects the size prop", () => {
    renderWithProvider(<SymbolAvatar symbol="TCS" logo={null} size={32} />);
    const avatar = screen.getByTestId("symbol-avatar");
    expect(avatar.style.width).toBe("32px");
    expect(avatar.style.height).toBe("32px");
  });
});
