// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ScreenerEmpty } from "./ScreenerEmpty";
import { MantineProvider } from "@mantine/core";

describe("ScreenerEmpty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders with default message", () => {
    render(
      <MantineProvider>
        <ScreenerEmpty />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-empty")).toBeInTheDocument();
    expect(screen.getByTestId("status")).toBeInTheDocument();
  });

  it("renders with custom message", () => {
    render(
      <MantineProvider>
        <ScreenerEmpty message="No stocks match your criteria" />
      </MantineProvider>,
    );
    expect(screen.getByText("No stocks match your criteria")).toBeInTheDocument();
  });

  it("renders icon", () => {
    render(
      <MantineProvider>
        <ScreenerEmpty />
      </MantineProvider>,
    );
    // The IconDatabaseOff should be rendered
    expect(screen.getByTestId("screener-empty")).toBeInTheDocument();
  });

  it("has correct test id", () => {
    render(
      <MantineProvider>
        <ScreenerEmpty />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-empty")).toBeInTheDocument();
  });

  it("renders with empty string message", () => {
    render(
      <MantineProvider>
        <ScreenerEmpty message="" />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-empty")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    render(
      <MantineProvider>
        <ScreenerEmpty />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-empty")).toHaveClass("screener-empty");
  });
});
