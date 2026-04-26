// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ScreenerLoading } from "./ScreenerLoading";
import { MantineProvider } from "@mantine/core";

describe("ScreenerLoading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders with default message", () => {
    render(
      <MantineProvider>
        <ScreenerLoading />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-loading")).toBeInTheDocument();
    expect(screen.getByText("Loading screener")).toBeInTheDocument();
  });

  it("renders with custom message", () => {
    render(
      <MantineProvider>
        <ScreenerLoading message="Fetching data..." />
      </MantineProvider>,
    );
    expect(screen.getByText("Fetching data...")).toBeInTheDocument();
  });

  it("renders loader component", () => {
    render(
      <MantineProvider>
        <ScreenerLoading />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-loader")).toBeInTheDocument();
  });

  it("has correct test id", () => {
    render(
      <MantineProvider>
        <ScreenerLoading />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-loading")).toBeInTheDocument();
  });

  it("renders with empty string message", () => {
    render(
      <MantineProvider>
        <ScreenerLoading message="" />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-loading")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    render(
      <MantineProvider>
        <ScreenerLoading />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-loading")).toHaveClass("screener-loading");
  });
});
