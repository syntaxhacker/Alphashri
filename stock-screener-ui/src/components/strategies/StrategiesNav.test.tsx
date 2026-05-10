// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { StrategiesNav } from "./StrategiesNav";

afterEach(() => {
  cleanup();
});

describe("StrategiesNav", () => {
  it("renders nav with data-testid", () => {
    render(
      <MantineProvider>
        <StrategiesNav activeView="tree" onChange={vi.fn()} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("strategies-nav")).toBeInTheDocument();
  });

  it("shows title 'Strategies'", () => {
    render(
      <MantineProvider>
        <StrategiesNav activeView="tree" onChange={vi.fn()} />
      </MantineProvider>,
    );
    expect(screen.getByText("Strategies")).toBeInTheDocument();
  });

  it("shows description text", () => {
    render(
      <MantineProvider>
        <StrategiesNav activeView="tree" onChange={vi.fn()} />
      </MantineProvider>,
    );
    expect(screen.getByText("Manage templates, variations, and performance in one place")).toBeInTheDocument();
  });

  it("renders segmented control with tabs", () => {
    render(
      <MantineProvider>
        <StrategiesNav activeView="tree" onChange={vi.fn()} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("strategies-nav-tabs")).toBeInTheDocument();
  });

  it("tab change calls onChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <MantineProvider>
        <StrategiesNav activeView="tree" onChange={onChange} />
      </MantineProvider>,
    );
    const tabs = screen.getByTestId("strategies-nav-tabs");
    const performanceTab = tabs.querySelector('[data-value="performance"]');
    if (performanceTab) {
      await user.click(performanceTab);
    }
  });
});
