// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StrategiesContainer } from "./StrategiesContainer";
import { UIProvider } from "@/ui";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";
import { initStrategiesState } from "../../state/strategies";

beforeEach(() => {
  setupBrowserMocks();
});

afterEach(() => {
  cleanup();
});

// Mock the hook and child component
vi.mock("../../hooks/useStrategiesState", () => ({
  useStrategiesState: () => ({
    strategies: [],
    selectedStrategyId: null,
    setSelectedStrategyId: vi.fn(),
    loading: false,
    error: null,
  }),
}));

vi.mock("../../state/strategies", () => ({
  initStrategiesState: vi.fn(),
}));

vi.mock("../../components/strategies/StrategiesPage", () => ({
  StrategiesPage: (props: any) => (
    <div data-testid="strategies-page">StrategiesPage - {Object.keys(props).length} props</div>
  ),
}));

describe("StrategiesContainer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders strategies container", () => {
    render(
      <UIProvider>
        <StrategiesContainer />
      </UIProvider>,
    );

    expect(screen.getByTestId("strategies-page")).toBeInTheDocument();
  });

  it("calls initStrategiesState on mount", () => {
    render(
      <UIProvider>
        <StrategiesContainer />
      </UIProvider>,
    );

    expect(vi.mocked(initStrategiesState)).toHaveBeenCalledTimes(1);
  });

  it("passes useStrategiesState props to StrategiesPage", () => {
    render(
      <UIProvider>
        <StrategiesContainer />
      </UIProvider>,
    );

    const page = screen.getByTestId("strategies-page");
    expect(page).toHaveTextContent("StrategiesPage - 5 props");
  });
});
