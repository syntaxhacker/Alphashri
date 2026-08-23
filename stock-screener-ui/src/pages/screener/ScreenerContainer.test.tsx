// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ScreenerContainer } from "./ScreenerContainer";
import { UIProvider } from "@/ui";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

const mockUseScreenerState = vi.fn();
const mockUseSearchParams = vi.fn();

vi.mock("react-router-dom", () => ({
  useNavigate: vi.fn(() => vi.fn()),
  useSearchParams: (...args: any[]) => mockUseSearchParams(...args),
}));

vi.mock("../../hooks/useScreenerState", () => ({
  useScreenerState: (...args: any[]) => mockUseScreenerState(...args),
}));

let lastScreenerPageProps: any = null;
vi.mock("../../components/screener/ScreenerPage", () => ({
  ScreenerPage: (props: any) => {
    lastScreenerPageProps = props;
    return (
      <div
        data-testid="screener-page"
        data-active-screener={props.activeScreener}
        data-is-loading={String(props.isLoading)}
        data-status={props.status}
        data-title={props.title}
        data-error={props.error ?? ""}
        data-warning={props.warning ?? ""}
        data-approaching-count={props.approachingStocks?.length ?? 0}
        data-touched-count={props.touchedStocks?.length ?? 0}
      >
        ScreenerPage - {props.title} - {props.status}
      </div>
    );
  },
}));

function makeScreenerState(overrides: Record<string, any> = {}) {
  return {
    approachingStocks: [],
    touchedStocks: [],
    screenerOptions: [
      { id: "trending", label: "Trending" },
      { id: "new-highs", label: "New Highs" },
    ],
    activeScreener: "trending",
    isLoading: false,
    error: null,
    warning: null,
    autoRefreshSeconds: 60,
    provider: "upstox",
    mode: "intraday",
    onRefresh: vi.fn(),
    onAutoRefreshChange: vi.fn(),
    onProviderChange: vi.fn(),
    onModeChange: vi.fn(),
    onScreenerChange: vi.fn(),
    onConfigScreenerSelect: vi.fn(),
    onSymbolClick: vi.fn(),
    onSymbolHover: vi.fn(),
    ...overrides,
  };
}

describe("ScreenerContainer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBrowserMocks();
    lastScreenerPageProps = null;
    mockUseSearchParams.mockReturnValue([new URLSearchParams(), vi.fn()]);
    mockUseScreenerState.mockReturnValue(makeScreenerState());
  });

  afterEach(() => {
    cleanup();
  });

  it("renders screener page", () => {
    render(
      <UIProvider>
        <ScreenerContainer />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-page")).toBeInTheDocument();
  });

  it("passes screener options title derived from activeScreener", () => {
    render(
      <UIProvider>
        <ScreenerContainer />
      </UIProvider>,
    );
    const page = screen.getByTestId("screener-page");
    expect(page).toHaveAttribute("data-title", "Trending | Alphashri");
    expect(page).toHaveTextContent("Trending | Alphashri");
  });

  it("passes active screener", () => {
    render(
      <UIProvider>
        <ScreenerContainer />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-page")).toHaveAttribute("data-active-screener", "trending");
  });

  it("passes loading state", () => {
    render(
      <UIProvider>
        <ScreenerContainer />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-page")).toHaveAttribute("data-is-loading", "false");
  });

  it("renders with mocked approaching and touched data", () => {
    const approaching = [{ symbol: "RELIANCE" }, { symbol: "TCS" }] as any;
    const touched = [{ symbol: "INFY" }] as any;
    mockUseScreenerState.mockReturnValue(makeScreenerState({ approachingStocks: approaching, touchedStocks: touched }));
    render(
      <UIProvider>
        <ScreenerContainer />
      </UIProvider>,
    );
    const page = screen.getByTestId("screener-page");
    expect(page).toHaveAttribute("data-approaching-count", "2");
    expect(page).toHaveAttribute("data-touched-count", "1");
    // status is sum of counts
    expect(page).toHaveAttribute("data-status", "3 stocks");
    expect(lastScreenerPageProps.approachingStocks).toEqual(approaching);
    expect(lastScreenerPageProps.touchedStocks).toEqual(touched);
  });

  it("shows Loading... status when isLoading true", () => {
    mockUseScreenerState.mockReturnValue(makeScreenerState({ isLoading: true }));
    render(
      <UIProvider>
        <ScreenerContainer />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-page")).toHaveAttribute("data-status", "Loading...");
  });

  it("passes error and warning through to ScreenerPage", () => {
    mockUseScreenerState.mockReturnValue(makeScreenerState({ error: "fetch failed", warning: "stale data" }));
    render(
      <UIProvider>
        <ScreenerContainer />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-page")).toHaveAttribute("data-error", "fetch failed");
    expect(screen.getByTestId("screener-page")).toHaveAttribute("data-warning", "stale data");
  });

  it("calls useScreenerState with undefined when no query param", () => {
    mockUseSearchParams.mockReturnValue([new URLSearchParams(), vi.fn()]);
    render(
      <UIProvider>
        <ScreenerContainer />
      </UIProvider>,
    );
    expect(mockUseScreenerState).toHaveBeenCalledWith(undefined);
  });

  it("parses screener query param without prefix", () => {
    mockUseSearchParams.mockReturnValue([new URLSearchParams("screener=new-highs"), vi.fn()]);
    render(
      <UIProvider>
        <ScreenerContainer />
      </UIProvider>,
    );
    expect(mockUseScreenerState).toHaveBeenCalledWith("new-highs");
  });

  it("parses builtin: prefix by taking last segment after colon", () => {
    mockUseSearchParams.mockReturnValue([new URLSearchParams("screener=builtin:trending"), vi.fn()]);
    render(
      <UIProvider>
        <ScreenerContainer />
      </UIProvider>,
    );
    expect(mockUseScreenerState).toHaveBeenCalledWith("trending");
  });

  it("handles nested colon only uses last segment", () => {
    mockUseSearchParams.mockReturnValue([new URLSearchParams("screener=a:b:c"), vi.fn()]);
    render(
      <UIProvider>
        <ScreenerContainer />
      </UIProvider>,
    );
    expect(mockUseScreenerState).toHaveBeenCalledWith("c");
  });

  it("falls back to generic Screener title when activeScreener not in options", () => {
    mockUseScreenerState.mockReturnValue(
      makeScreenerState({
        activeScreener: "unknown",
        screenerOptions: [{ id: "trending", label: "Trending" }],
      }),
    );
    render(
      <UIProvider>
        <ScreenerContainer />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-page")).toHaveAttribute("data-title", "Screener | Alphashri");
  });

  it("passes callbacks to ScreenerPage", () => {
    const onRefresh = vi.fn();
    const onScreenerChange = vi.fn();
    mockUseScreenerState.mockReturnValue(makeScreenerState({ onRefresh, onScreenerChange }));
    render(
      <UIProvider>
        <ScreenerContainer />
      </UIProvider>,
    );
    expect(lastScreenerPageProps.onRefresh).toBe(onRefresh);
    expect(lastScreenerPageProps.onScreenerChange).toBe(onScreenerChange);
    expect(lastScreenerPageProps.onConfigScreenerSelect).toBeDefined();
  });
});
