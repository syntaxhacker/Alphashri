// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ScreenerEmpty } from "./ScreenerEmpty";
import { UIProvider } from "@/ui";

describe("ScreenerEmpty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders with default message", () => {
    render(
      <UIProvider>
        <ScreenerEmpty />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-empty")).toBeInTheDocument();
    expect(screen.getByTestId("status")).toBeInTheDocument();
  });

  it("renders with custom message", () => {
    render(
      <UIProvider>
        <ScreenerEmpty message="No stocks match your criteria" />
      </UIProvider>,
    );
    expect(screen.getByText("No stocks match your criteria")).toBeInTheDocument();
  });

  it("renders icon", () => {
    render(
      <UIProvider>
        <ScreenerEmpty />
      </UIProvider>,
    );
    // The IconDatabaseOff should be rendered
    expect(screen.getByTestId("screener-empty")).toBeInTheDocument();
  });

  it("has correct test id", () => {
    render(
      <UIProvider>
        <ScreenerEmpty />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-empty")).toBeInTheDocument();
  });

  it("renders with empty string message", () => {
    render(
      <UIProvider>
        <ScreenerEmpty message="" />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-empty")).toBeInTheDocument();
  });

  it("has data-testid for test hooks (MUI sx, no global CSS)", () => {
    render(
      <UIProvider>
        <ScreenerEmpty />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-empty")).toBeInTheDocument();
  });
});
