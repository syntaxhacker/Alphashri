// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { UIProvider, Tabs } from "@/ui";
import { OrbParamsPanel } from "./OrbParamsPanel";
import { DEFAULT_VALUES } from "./strategyDefaults";

afterEach(() => {
  cleanup();

  vi.clearAllMocks();
});

function renderInTabs(initialValues = DEFAULT_VALUES, isSwing = false) {
  return render(
    <UIProvider>
      <Tabs value="orb">
        <OrbParamsPanel initialValues={initialValues} isSwing={isSwing} />
      </Tabs>
    </UIProvider>,
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
