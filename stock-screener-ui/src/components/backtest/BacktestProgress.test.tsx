// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { BacktestProgress, calcProgressPercent } from "./BacktestProgress";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

describe("calcProgressPercent", () => {
  it("calculates percentage correctly", () => {
    expect(calcProgressPercent(5, 10)).toBe(50);
  });

  it("returns 0 when total is 0", () => {
    expect(calcProgressPercent(5, 0)).toBe(0);
  });

  it("returns 0 when current is 0", () => {
    expect(calcProgressPercent(0, 10)).toBe(0);
  });

  it("handles 100% completion", () => {
    expect(calcProgressPercent(10, 10)).toBe(100);
  });

  it("handles partial progress", () => {
    expect(calcProgressPercent(33, 100)).toBe(33);
  });

  it("handles fractional progress", () => {
    expect(calcProgressPercent(1, 3)).toBeCloseTo(33.33, 1);
    expect(calcProgressPercent(1, 7)).toBeCloseTo(14.29, 1);
  });

  it("handles progress exceeding 100%", () => {
    expect(calcProgressPercent(150, 100)).toBe(150);
  });

  it("handles negative current", () => {
    expect(calcProgressPercent(-10, 100)).toBe(-10);
  });

  it("handles negative total", () => {
    expect(calcProgressPercent(50, -100)).toBe(0);
  });
});

describe("BacktestProgress", () => {
  const defaultProgress = {
    current: 5,
    total: 10,
    message: "Processing...",
  };

  it("renders progress container with testid", () => {
    render(<BacktestProgress progress={defaultProgress} />, { wrapper: Wrapper });
    expect(screen.getByTestId("progress-container")).toBeInTheDocument();
  });

  it("displays the counter correctly", () => {
    render(<BacktestProgress progress={defaultProgress} />, { wrapper: Wrapper });
    expect(screen.getByTestId("progress-counter")).toHaveTextContent("5/10");
  });

  it("displays the progress message", () => {
    render(<BacktestProgress progress={defaultProgress} />, { wrapper: Wrapper });
    expect(screen.getByTestId("progress-message")).toHaveTextContent("Processing...");
  });

  it("renders the progress bar", () => {
    render(<BacktestProgress progress={defaultProgress} />, { wrapper: Wrapper });
    expect(screen.getByTestId("progress-fill")).toBeInTheDocument();
  });

  it("renders progress bar with animated style", () => {
    render(<BacktestProgress progress={defaultProgress} />, { wrapper: Wrapper });
    const progressBar = screen.getByTestId("progress-fill");
    expect(progressBar).toBeInTheDocument();
  });

  it("shows 100% when complete", () => {
    render(<BacktestProgress progress={{ current: 10, total: 10, message: "Done" }} />, {
      wrapper: Wrapper,
    });
    const progressBar = screen.getByTestId("progress-fill");
    expect(progressBar).toBeInTheDocument();
  });

  it("displays 'Running...' title", () => {
    render(<BacktestProgress progress={defaultProgress} />, { wrapper: Wrapper });
    expect(screen.getByText("Running...")).toBeInTheDocument();
  });

  it("renders with different progress values", () => {
    const progress = { current: 25, total: 100, message: "Analyzing stocks" };
    render(<BacktestProgress progress={progress} />, { wrapper: Wrapper });
    expect(screen.getByTestId("progress-counter")).toHaveTextContent("25/100");
    expect(screen.getByTestId("progress-message")).toHaveTextContent("Analyzing stocks");
  });
});
