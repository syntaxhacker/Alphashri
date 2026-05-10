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

  it("renders with default message 'No results found'", () => {
    render(
      <MantineProvider>
        <ScreenerEmpty />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-empty")).toBeInTheDocument();
    expect(screen.getAllByText("No results found").length).toBeGreaterThanOrEqual(1);
  });

  it("renders with custom message", () => {
    render(
      <MantineProvider>
        <ScreenerEmpty message="No stocks match your criteria" />
      </MantineProvider>,
    );
    expect(screen.getByText("No stocks match your criteria")).toBeInTheDocument();
  });

  it("renders icon (IconDatabaseOff)", () => {
    render(
      <MantineProvider>
        <ScreenerEmpty />
      </MantineProvider>,
    );
    // IconDatabaseOff renders as an SVG inside the panel title
    const panel = screen.getByTestId("screener-empty");
    const svg = panel.querySelector("svg");
    expect(svg).toBeInTheDocument();
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
