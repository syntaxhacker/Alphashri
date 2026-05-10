// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MantineProvider, Tabs } from "@mantine/core";
import { OrbParamsPanel } from "./OrbParamsPanel";
import { DEFAULT_VALUES } from "./strategyDefaults";

afterEach(() => {
  cleanup();
});

function renderInTabs(initialValues = DEFAULT_VALUES, isSwing = false) {
  return render(
    <MantineProvider>
      <Tabs value="orb">
        <OrbParamsPanel initialValues={initialValues} isSwing={isSwing} />
      </Tabs>
    </MantineProvider>,
  );
}

describe("OrbParamsPanel", () => {
  it("panel renders with data-testid", () => {
    renderInTabs();
    expect(screen.getByTestId("strategy-panel-orb")).toBeInTheDocument();
  });

  it("renders OR Duration input with min suffix", () => {
    renderInTabs();
    expect(screen.getByTestId("strategy-or-minutes-input")).toBeInTheDocument();
    expect(screen.getByText("OR Duration (min)")).toBeInTheDocument();
  });

  it("renders Min Range input with '% of price' suffix", () => {
    renderInTabs();
    expect(screen.getByTestId("strategy-min-or-range-input")).toBeInTheDocument();
    expect(screen.getByText("Min Range")).toBeInTheDocument();
  });

  it("renders SL% and TP% inputs via SlTpRow", () => {
    renderInTabs();
    expect(screen.getByTestId("strategy-sl-pct-input")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-tp-pct-input")).toBeInTheDocument();
  });

  it("renders Max Range input with '% of price' suffix", () => {
    renderInTabs();
    expect(screen.getByTestId("strategy-max-or-range-input")).toBeInTheDocument();
    expect(screen.getByText("Max Range")).toBeInTheDocument();
  });
});
