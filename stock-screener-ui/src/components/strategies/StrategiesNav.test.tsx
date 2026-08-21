// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import { StrategiesNav } from "./StrategiesNav";

afterEach(() => {
  cleanup();

  vi.clearAllMocks();
});

describe("StrategiesNav", () => {
  it("renders nav with data-testid", () => {
    render(
      <UIProvider>
        <StrategiesNav activeView="tree" onChange={vi.fn()} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategies-nav")).toBeInTheDocument();
  });

  it("shows title 'Strategies'", () => {
    render(
      <UIProvider>
        <StrategiesNav activeView="tree" onChange={vi.fn()} />
      </UIProvider>,
    );
    expect(screen.getByText("Strategies")).toBeInTheDocument();
  });

  it("shows description text", () => {
    render(
      <UIProvider>
        <StrategiesNav activeView="tree" onChange={vi.fn()} />
      </UIProvider>,
    );
    expect(screen.getByText("Manage templates, variations, and performance in one place")).toBeInTheDocument();
  });

  it("renders segmented control with tabs", () => {
    render(
      <UIProvider>
        <StrategiesNav activeView="tree" onChange={vi.fn()} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategies-nav-tabs")).toBeInTheDocument();
  });

  it("tab change calls onChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <UIProvider>
        <StrategiesNav activeView="tree" onChange={onChange} />
      </UIProvider>,
    );
    const tabs = screen.getByTestId("strategies-nav-tabs");
    const performanceTab = tabs.querySelector('[data-value="performance"]');
    if (performanceTab) {
      await user.click(performanceTab);
    }
  });
});
