// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { OptionsContainer } from "./OptionsContainer";
import { UIProvider } from "@/ui";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

// The @/ui layout stubs render as intrinsic elements so this test
// exercises the page wiring, not the broken primitive layer. See solidTestStubs.tsx.
vi.mock("@/ui", async (importOriginal) => {
  const { uiLayoutStub } = await import("@/pages/solidTestStubs");
  return uiLayoutStub(await importOriginal<Record<string, unknown>>());
});

beforeEach(() => {
  setupBrowserMocks();
});

afterEach(() => {
  cleanup();

  vi.clearAllMocks();
});

// Mock the hook and child component
vi.mock("../../hooks/useOptionsState", () => ({
  useOptionsState: () => ({
    // Mock whatever props OptionsPage expects
    chainData: [],
    positions: [],
    selectedSymbol: null,
    setSelectedSymbol: vi.fn(),
    loading: false,
    error: null,
  }),
}));

vi.mock("../../components/options/OptionsPage", () => ({
  OptionsPage: (props: any) => (
    <div data-testid="options-page" data-active-tab={props.activeTab}>
      OptionsPage - {Object.keys(props).length - 2} props
    </div>
  ),
}));

describe("OptionsContainer", () => {
  it("renders options container with testid", () => {
    render(() => (
      <UIProvider>
        <OptionsContainer />
      </UIProvider>
    ));

    expect(screen.getByTestId("options-container")).toBeInTheDocument();
  });

  it("renders OptionsPage child component", () => {
    render(() => (
      <UIProvider>
        <OptionsContainer />
      </UIProvider>
    ));

    expect(screen.getByTestId("options-page")).toBeInTheDocument();
  });

  it("passes activeTab and setActiveTab to OptionsPage", () => {
    render(() => (
      <UIProvider>
        <OptionsContainer />
      </UIProvider>
    ));

    const optionsPage = screen.getByTestId("options-page");
    expect(optionsPage).toHaveAttribute("data-active-tab", "chain");
  });

  it("passes useOptionsState props to OptionsPage", () => {
    render(() => (
      <UIProvider>
        <OptionsContainer />
      </UIProvider>
    ));

    const optionsPage = screen.getByTestId("options-page");
    expect(optionsPage).toHaveTextContent("OptionsPage - 6 props");
  });
});
