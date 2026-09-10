// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ScreenerLoading } from "./ScreenerLoading";
import { UIProvider } from "@/ui";

describe("ScreenerLoading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders with default message", () => {
    render(
      <UIProvider>
        <ScreenerLoading />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-loading")).toBeInTheDocument();
    expect(screen.getByText("Loading screener")).toBeInTheDocument();
  });

  it("renders with custom message", () => {
    render(
      <UIProvider>
        <ScreenerLoading message="Fetching data..." />
      </UIProvider>,
    );
    expect(screen.getByText("Fetching data...")).toBeInTheDocument();
  });

  it("renders loader component", () => {
    render(
      <UIProvider>
        <ScreenerLoading />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-loader")).toBeInTheDocument();
  });

  it("has correct test id", () => {
    render(
      <UIProvider>
        <ScreenerLoading />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-loading")).toBeInTheDocument();
  });

  it("renders with empty string message", () => {
    render(
      <UIProvider>
        <ScreenerLoading message="" />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-loading")).toBeInTheDocument();
  });

  it("has data-testid for test hooks (MUI sx, no global CSS)", () => {
    render(
      <UIProvider>
        <ScreenerLoading />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-loading")).toBeInTheDocument();
    expect(screen.getByTestId("screener-loader")).toBeInTheDocument();
  });
});
