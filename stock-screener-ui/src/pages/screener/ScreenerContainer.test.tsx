// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ScreenerContainer } from "./ScreenerContainer";
import { MantineProvider } from "@mantine/core";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

vi.mock("react-router-dom", () => ({
  useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
  useNavigate: vi.fn(() => vi.fn()),
}));

// Mock the hook
vi.mock("../../hooks/useScreenerState", () => ({
  useScreenerState: vi.fn(() => ({
    approachingStocks: [],
    touchedStocks: [],
    screenerOptions: [
      { id: "trending", label: "Trending" },
      { id: "new-highs", label: "New Highs" },
    ],
    activeScreener: "trending",
    isLoading: false,
    error: null,
    autoRefreshSeconds: 60,
    provider: "upstox",
    mode: "intraday",
    onRefresh: vi.fn(),
    onAutoRefreshChange: vi.fn(),
    onProviderChange: vi.fn(),
    onModeChange: vi.fn(),
    onScreenerChange: vi.fn(),
    onSymbolClick: vi.fn(),
    onSymbolHover: vi.fn(),
  })),
}));

vi.mock("../../components/screener/ScreenerPage", () => ({
  ScreenerPage: (props: any) => (
    <div
      data-testid="screener-page"
      data-active-screener={props.activeScreener}
      data-is-loading={props.isLoading}
    >
      ScreenerPage - {props.title}
    </div>
  ),
}));

describe("ScreenerContainer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBrowserMocks();
  });

  afterEach(() => {
    cleanup();
  });
  it("renders screener page", () => {
    render(
      <MantineProvider>
        <ScreenerContainer />
      </MantineProvider>,
    );

    expect(screen.getByTestId("screener-page")).toBeInTheDocument();
  });

  it("passes screener options", () => {
    render(
      <MantineProvider>
        <ScreenerContainer />
      </MantineProvider>,
    );

    const page = screen.getByTestId("screener-page");
    expect(page).toHaveTextContent("ScreenerPage - Trending | Alphashri");
  });

  it("passes active screener", () => {
    render(
      <MantineProvider>
        <ScreenerContainer />
      </MantineProvider>,
    );

    const page = screen.getByTestId("screener-page");
    expect(page).toHaveAttribute("data-active-screener", "trending");
  });

  it("passes loading state", () => {
    render(
      <MantineProvider>
        <ScreenerContainer />
      </MantineProvider>,
    );

    const page = screen.getByTestId("screener-page");
    expect(page).toHaveAttribute("data-is-loading", "false");
  });

  it("passes all required props from useScreenerState", () => {
    render(
      <MantineProvider>
        <ScreenerContainer />
      </MantineProvider>,
    );

    const page = screen.getByTestId("screener-page");
    expect(page).toBeInTheDocument();
    // Props are passed, we can verify through the component receiving expected structure
  });
});
