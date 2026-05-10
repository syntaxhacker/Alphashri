// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MantineProvider, Tabs } from "@mantine/core";
import { RunnerPanel } from "./RunnerPanel";
import { DEFAULT_VALUES } from "./strategyDefaults";

afterEach(() => {
  cleanup();
});

function renderInTabs(isOrb = true) {
  return render(
    <MantineProvider>
      <Tabs value="runner">
        <RunnerPanel initialValues={DEFAULT_VALUES} isOrb={isOrb} />
      </Tabs>
    </MantineProvider>,
  );
}

describe("RunnerPanel", () => {
  it("panel renders with data-testid", () => {
    renderInTabs();
    expect(screen.getByTestId("strategy-panel-runner")).toBeInTheDocument();
  });

  it("renders Max Distance from OR input for ORB types", () => {
    renderInTabs(true);
    expect(screen.getByTestId("strategy-max-distance-input")).toBeInTheDocument();
  });

  it("does not render Max Distance from OR for non-ORB types", () => {
    renderInTabs(false);
    expect(screen.queryByTestId("strategy-max-distance-input")).not.toBeInTheDocument();
  });

  it("renders Enable Shorts switch", () => {
    renderInTabs();
    expect(screen.getByTestId("strategy-enable-shorts-input")).toBeInTheDocument();
  });

  it("renders EOD Exit Hour input", () => {
    renderInTabs();
    expect(screen.getByTestId("strategy-eod-hour-input")).toBeInTheDocument();
  });

  it("renders EOD Exit Minute input", () => {
    renderInTabs();
    expect(screen.getByTestId("strategy-eod-minute-input")).toBeInTheDocument();
  });
});
