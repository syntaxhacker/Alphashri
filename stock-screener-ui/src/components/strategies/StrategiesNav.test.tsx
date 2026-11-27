// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { StrategiesNav } from "./StrategiesNav";

afterEach(() => {
  cleanup();

  vi.clearAllMocks();
});

describe("StrategiesNav", () => {
  it("renders nav with data-testid", () => {
    render(() => (
      <UIProvider>
        <StrategiesNav activeView="tree" onChange={vi.fn()} />
      </UIProvider>
    ));
    expect(screen.getByTestId("strategies-nav")).toBeInTheDocument();
  });

  it("shows title 'Strategies'", () => {
    render(() => (
      <UIProvider>
        <StrategiesNav activeView="tree" onChange={vi.fn()} />
      </UIProvider>
    ));
    expect(screen.getByText("Strategies")).toBeInTheDocument();
  });

  it("keeps the identity band to the title and view switch — no generic subtitle", () => {
    render(() => (
      <UIProvider>
        <StrategiesNav activeView="tree" onChange={vi.fn()} />
      </UIProvider>
    ));
    expect(screen.queryByText("Manage templates, variations, and performance in one place")).not.toBeInTheDocument();
  });

  it("renders segmented control with tabs", () => {
    render(() => (
      <UIProvider>
        <StrategiesNav activeView="tree" onChange={vi.fn()} />
      </UIProvider>
    ));
    expect(screen.getByTestId("strategies-nav-tabs")).toBeInTheDocument();
  });

});
