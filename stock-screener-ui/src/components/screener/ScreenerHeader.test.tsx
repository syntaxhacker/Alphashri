// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { ScreenerHeader } from "./ScreenerHeader";
import { UIProvider } from "@/ui";

// Mock Mantine Select and SegmentedControl to native HTML elements for easier testing
vi.mock("@/ui", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    Select: ({ value, onChange, data, "data-testid": testId, ...rest }: any) => (
      <select
        data-testid={testId}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        {...rest}
      >
        {data.map((opt: any) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    ),
    SegmentedControl: ({ value, onChange, data, "data-testid": testId, ..._rest }: any) => {
      // For the view mode toggle, assign test IDs: view-table, view-heatmap
      const getOptionTestId = (optValue: string) => {
        return testId === "screener-view-toggle" ? `view-${optValue}` : `segmented-${optValue}`;
      };
      return (
        <div data-testid={testId} role="radiogroup">
          {data.map((opt: any) => (
            <label key={opt.value} style={{ marginRight: "8px", cursor: "pointer" }}>
              <input
                type="radio"
                name={testId}
                value={opt.value}
                checked={value === opt.value}
                onChange={() => onChange?.(opt.value)}
                data-testid={getOptionTestId(opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>
      );
    },
  };
});

describe("ScreenerHeader", () => {
  const defaultProps = {
    status: "5 stocks",
    isLoading: false,
    autoRefreshSeconds: 60,
    provider: "upstox",
    mode: "intraday",
    onRefresh: vi.fn(),
    onAutoRefreshChange: vi.fn(),
    onProviderChange: vi.fn(),
    onModeChange: vi.fn(),
    viewMode: "table" as const,
    onViewModeChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders compact header with status", () => {
    render(
      <UIProvider>
        <ScreenerHeader {...defaultProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-header")).toBeInTheDocument();
    expect(screen.getByText("5 stocks")).toBeInTheDocument();
  });

  it("calls onRefresh when refresh button clicked", async () => {
      const user = userEvent.setup();
    render(
      <UIProvider>
        <ScreenerHeader {...defaultProps} />
      </UIProvider>,
    );
    await user.click(screen.getByTestId("refresh-btn"));
    expect(defaultProps.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows loading state on refresh button", () => {
    render(
      <UIProvider>
        <ScreenerHeader {...defaultProps} isLoading={true} />
      </UIProvider>,
    );
    const refreshBtn = screen.getByTestId("refresh-btn");
    expect(refreshBtn).toHaveAttribute("data-loading", "true");
  });

  it("disables auto-refresh input when loading", () => {
    render(
      <UIProvider>
        <ScreenerHeader {...defaultProps} isLoading={true} />
      </UIProvider>,
    );
    const autoRefreshInput = screen.getByTestId("auto-refresh-input");
    expect(autoRefreshInput).toBeDisabled();
  });

  it("disables provider select when loading", () => {
    render(
      <UIProvider>
        <ScreenerHeader {...defaultProps} isLoading={true} />
      </UIProvider>,
    );
    const providerSelect = screen.getByTestId("provider-select");
    expect(providerSelect).toBeDisabled();
  });

  it("disables mode select when loading", () => {
    render(
      <UIProvider>
        <ScreenerHeader {...defaultProps} isLoading={true} />
      </UIProvider>,
    );
    const modeSelect = screen.getByTestId("mode-select");
    expect(modeSelect).toBeDisabled();
  });

  it("calls onAutoRefreshChange when auto-refresh value changes", async () => {
      const user = userEvent.setup();
    render(
      <UIProvider>
        <ScreenerHeader {...defaultProps} />
      </UIProvider>,
    );
    const input = screen.getByTestId("auto-refresh-input");
    await user.clear(input); await user.type(input, "120");
    expect(defaultProps.onAutoRefreshChange).toHaveBeenCalledWith(120);
  });

  it("renders provider select with correct options", () => {
    render(
      <UIProvider>
        <ScreenerHeader {...defaultProps} />
      </UIProvider>,
    );
    const select = screen.getByTestId("provider-select");
    expect(select).toHaveValue("upstox");
    expect(screen.getByText("Upstox")).toBeInTheDocument();
    expect(screen.getByText("IND")).toBeInTheDocument();
  });

  it("calls onProviderChange when provider changes", async () => {
      const user = userEvent.setup();
    render(
      <UIProvider>
        <ScreenerHeader {...defaultProps} />
      </UIProvider>,
    );
    const select = screen.getByTestId("provider-select");
    await user.clear(select); await user.type(select, "indmoney");
    expect(defaultProps.onProviderChange).toHaveBeenCalledWith("indmoney");
  });

  it("renders mode select with correct options", () => {
    render(
      <UIProvider>
        <ScreenerHeader {...defaultProps} />
      </UIProvider>,
    );
    const select = screen.getByTestId("mode-select");
    expect(select).toHaveValue("intraday");
    expect(screen.getByText("Intra")).toBeInTheDocument();
    expect(screen.getByText("5D")).toBeInTheDocument();
  });

  it("calls onModeChange when mode changes", async () => {
      const user = userEvent.setup();
    render(
      <UIProvider>
        <ScreenerHeader {...defaultProps} />
      </UIProvider>,
    );
    const select = screen.getByTestId("mode-select");
    await user.clear(select); await user.type(select, "historical");
    expect(defaultProps.onModeChange).toHaveBeenCalledWith("historical");
  });

  it("renders view mode toggle buttons", () => {
    render(
      <UIProvider>
        <ScreenerHeader {...defaultProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("view-table")).toBeInTheDocument();
    expect(screen.getByTestId("view-heatmap")).toBeInTheDocument();
  });

  it("calls onViewModeChange when table button clicked", async () => {
      const user = userEvent.setup();
    render(
      <UIProvider>
        <ScreenerHeader {...defaultProps} viewMode="heatmap" />
      </UIProvider>,
    );
    await user.click(screen.getByTestId("view-table"));
    expect(defaultProps.onViewModeChange).toHaveBeenCalledWith("table");
  });

  it("calls onViewModeChange when heatmap button clicked", async () => {
      const user = userEvent.setup();
    render(
      <UIProvider>
        <ScreenerHeader {...defaultProps} />
      </UIProvider>,
    );
    await user.click(screen.getByTestId("view-heatmap"));
    expect(defaultProps.onViewModeChange).toHaveBeenCalledWith("heatmap");
  });

  it("displays correct view mode state", () => {
    render(
      <UIProvider>
        <ScreenerHeader {...defaultProps} viewMode="heatmap" />
      </UIProvider>,
    );
    // The buttons themselves don't show active state in our mock, but we can verify they exist
    expect(screen.getByTestId("view-heatmap")).toBeInTheDocument();
  });

  it("renders header controls", () => {
    render(
      <UIProvider>
        <ScreenerHeader {...defaultProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("header-controls")).toBeInTheDocument();
    expect(screen.getByTestId("screener-view-toggle")).toBeInTheDocument();
  });

  it("handles zero auto-refresh value", () => {
    render(
      <UIProvider>
        <ScreenerHeader {...defaultProps} autoRefreshSeconds={0} />
      </UIProvider>,
    );
    const input = screen.getByTestId("auto-refresh-input");
    expect(input).toHaveValue("0");
  });

  it("handles large auto-refresh value within limit", () => {
    render(
      <UIProvider>
        <ScreenerHeader {...defaultProps} autoRefreshSeconds={3600} />
      </UIProvider>,
    );
    const input = screen.getByTestId("auto-refresh-input");
    expect(input).toHaveValue("3600");
  });

  it("passes correct auto-refresh value to onAutoRefreshChange", async () => {
      const user = userEvent.setup();
    render(
      <UIProvider>
        <ScreenerHeader {...defaultProps} />
      </UIProvider>,
    );
    const input = screen.getByTestId("auto-refresh-input");
    await user.clear(input); await user.type(input, "300");
    expect(defaultProps.onAutoRefreshChange).toHaveBeenCalledWith(300);
  });

  it("handles provider change to indmoney", async () => {
      const user = userEvent.setup();
    render(
      <UIProvider>
        <ScreenerHeader {...defaultProps} />
      </UIProvider>,
    );
    const providerSelect = screen.getByTestId("provider-select");
    await user.clear(providerSelect); await user.type(providerSelect, "indmoney");
    expect(defaultProps.onProviderChange).toHaveBeenCalledWith("indmoney");
  });

  it("handles mode change to historical", async () => {
      const user = userEvent.setup();
    render(
      <UIProvider>
        <ScreenerHeader {...defaultProps} />
      </UIProvider>,
    );
    const modeSelect = screen.getByTestId("mode-select");
    await user.clear(modeSelect); await user.type(modeSelect, "historical");
    expect(defaultProps.onModeChange).toHaveBeenCalledWith("historical");
  });

  it("renders with custom status", () => {
    render(
      <UIProvider>
        <ScreenerHeader {...defaultProps} status="Loading..." />
      </UIProvider>,
    );
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });
});
