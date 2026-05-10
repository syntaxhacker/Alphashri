// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OptionsContainer } from "./OptionsContainer";
import { MantineProvider } from "@mantine/core";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

beforeEach(() => {
  setupBrowserMocks();
});

afterEach(() => {
  cleanup();
});

// Mock the hook and child component
vi.mock("../../hooks/useOptionsState", () => ({
  useOptionsState: () => ({
    chainData: [],
    positions: [],
    selectedSymbol: null,
    setSelectedSymbol: vi.fn(),
    loading: false,
    error: null,
  }),
}));

vi.mock("../../components/options/OptionsPage", () => ({
  OptionsPage: ({ activeTab, setActiveTab: _setActiveTab, ...props }: any) => (
    <div data-testid="options-page" data-active-tab={activeTab}>
      OptionsPage - {Object.keys(props).length} props
    </div>
  ),
}));

describe("OptionsContainer", () => {
  it("renders options container with testid", () => {
    render(
      <MantineProvider>
        <OptionsContainer />
      </MantineProvider>,
    );

    expect(screen.getByTestId("options-container")).toBeInTheDocument();
  });

  it("renders OptionsPage child component", () => {
    render(
      <MantineProvider>
        <OptionsContainer />
      </MantineProvider>,
    );

    expect(screen.getByTestId("options-page")).toBeInTheDocument();
  });

  it("defaults activeTab to chain", () => {
    render(
      <MantineProvider>
        <OptionsContainer />
      </MantineProvider>,
    );

    const optionsPage = screen.getByTestId("options-page");
    expect(optionsPage).toHaveAttribute("data-active-tab", "chain");
  });

  it("passes useOptionsState props to OptionsPage", () => {
    render(
      <MantineProvider>
        <OptionsContainer />
      </MantineProvider>,
    );

    const optionsPage = screen.getByTestId("options-page");
    expect(optionsPage).toHaveTextContent("OptionsPage - 6 props");
  });
});
