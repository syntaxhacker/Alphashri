// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MantineProvider, Tabs } from "@mantine/core";
import { RiskManagementPanel } from "./RiskManagementPanel";
import { DEFAULT_VALUES } from "./strategyDefaults";

afterEach(() => {
  cleanup();
});

function renderInTabs(isIntraday = true) {
  return render(
    <MantineProvider>
      <Tabs value="risk">
        <RiskManagementPanel initialValues={DEFAULT_VALUES} isIntraday={isIntraday} />
      </Tabs>
    </MantineProvider>,
  );
}

describe("RiskManagementPanel", () => {
  it("panel renders with data-testid", () => {
    renderInTabs();
    expect(screen.getByTestId("strategy-panel-risk")).toBeInTheDocument();
  });

  it("renders Risk Per Trade % input with description", () => {
    renderInTabs();
    expect(screen.getByTestId("strategy-risk-per-trade-input")).toBeInTheDocument();
    expect(screen.getByText("Risk Per Trade %")).toBeInTheDocument();
  });

  it("renders Max Position Size % input with description", () => {
    renderInTabs();
    expect(screen.getByTestId("strategy-capital-per-trade-input")).toBeInTheDocument();
    expect(screen.getByText("Max Position Size %")).toBeInTheDocument();
  });

  it("renders Min Trade Value input with ₹ prefix", () => {
    renderInTabs();
    expect(screen.getByTestId("strategy-min-trade-value-input")).toBeInTheDocument();
    expect(screen.getByText("Min Trade Value (₹)")).toBeInTheDocument();
  });

  it("renders Max Trade Value input with ₹ prefix", () => {
    renderInTabs();
    expect(screen.getByTestId("strategy-max-trade-value-input")).toBeInTheDocument();
    expect(screen.getByText("Max Trade Value (₹)")).toBeInTheDocument();
  });

  it("renders Cooldown Minutes input for intraday types", () => {
    renderInTabs(true);
    expect(screen.getByTestId("strategy-cooldown-input")).toBeInTheDocument();
    expect(screen.getByText("Cooldown Minutes")).toBeInTheDocument();
  });

  it("renders Cooldown Days input for swing types", () => {
    renderInTabs(false);
    expect(screen.getByTestId("strategy-cooldown-input")).toBeInTheDocument();
    expect(screen.getByText("Cooldown Days")).toBeInTheDocument();
  });

  it("shows description text about strategy capital allocation", () => {
    renderInTabs();
    expect(screen.getByText(/allocated to this strategy/)).toBeInTheDocument();
  });
});
