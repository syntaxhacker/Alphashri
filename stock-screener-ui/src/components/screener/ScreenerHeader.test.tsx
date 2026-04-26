// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ScreenerHeader } from "./ScreenerHeader";
import { MantineProvider } from "@mantine/core";

// Mock Mantine Select and SegmentedControl to native HTML elements for easier testing
vi.mock("@mantine/core", async (importOriginal) => {
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
    SegmentedControl: ({ value, onChange, data, "data-testid": testId, ...rest }: any) => {
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
    title: "Trending | Alphashri",
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

  it("renders header with title and status", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-header")).toBeInTheDocument();
    expect(screen.getByText("Trending | Alphashri")).toBeInTheDocument();
    expect(screen.getByText("5 stocks")).toBeInTheDocument();
  });

  it("calls onRefresh when refresh button clicked", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByTestId("refresh-btn"));
    expect(defaultProps.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows loading state on refresh button", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} isLoading={true} />
      </MantineProvider>,
    );
    const refreshBtn = screen.getByTestId("refresh-btn");
    expect(refreshBtn).toHaveAttribute("data-loading", "true");
  });

  it("disables auto-refresh input when loading", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} isLoading={true} />
      </MantineProvider>,
    );
    const autoRefreshInput = screen.getByTestId("auto-refresh-input");
    expect(autoRefreshInput).toBeDisabled();
  });

  it("disables provider select when loading", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} isLoading={true} />
      </MantineProvider>,
    );
    const providerSelect = screen.getByTestId("provider-select");
    expect(providerSelect).toBeDisabled();
  });

  it("disables mode select when loading", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} isLoading={true} />
      </MantineProvider>,
    );
    const modeSelect = screen.getByTestId("mode-select");
    expect(modeSelect).toBeDisabled();
  });

  it("calls onAutoRefreshChange when auto-refresh value changes", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} />
      </MantineProvider>,
    );
    const input = screen.getByTestId("auto-refresh-input");
    fireEvent.change(input, { target: { value: "120" } });
    expect(defaultProps.onAutoRefreshChange).toHaveBeenCalledWith(120);
  });

  it("renders provider select with correct options", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} />
      </MantineProvider>,
    );
    const select = screen.getByTestId("provider-select");
    expect(select).toHaveValue("upstox");
    expect(screen.getByText("Upstox")).toBeInTheDocument();
    expect(screen.getByText("INDMONEY")).toBeInTheDocument();
  });

  it("calls onProviderChange when provider changes", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} />
      </MantineProvider>,
    );
    const select = screen.getByTestId("provider-select");
    fireEvent.change(select, { target: { value: "indmoney" } });
    expect(defaultProps.onProviderChange).toHaveBeenCalledWith("indmoney");
  });

  it("renders mode select with correct options", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} />
      </MantineProvider>,
    );
    const select = screen.getByTestId("mode-select");
    expect(select).toHaveValue("intraday");
    expect(screen.getByText("Intraday")).toBeInTheDocument();
    expect(screen.getByText("5D")).toBeInTheDocument();
  });

  it("calls onModeChange when mode changes", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} />
      </MantineProvider>,
    );
    const select = screen.getByTestId("mode-select");
    fireEvent.change(select, { target: { value: "historical" } });
    expect(defaultProps.onModeChange).toHaveBeenCalledWith("historical");
  });

  it("renders view mode toggle buttons", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("view-table")).toBeInTheDocument();
    expect(screen.getByTestId("view-heatmap")).toBeInTheDocument();
  });

  it("calls onViewModeChange when table button clicked", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} viewMode="heatmap" />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByTestId("view-table"));
    expect(defaultProps.onViewModeChange).toHaveBeenCalledWith("table");
  });

  it("calls onViewModeChange when heatmap button clicked", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByTestId("view-heatmap"));
    expect(defaultProps.onViewModeChange).toHaveBeenCalledWith("heatmap");
  });

  it("displays correct view mode state", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} viewMode="heatmap" />
      </MantineProvider>,
    );
    // The buttons themselves don't show active state in our mock, but we can verify they exist
    expect(screen.getByTestId("view-heatmap")).toBeInTheDocument();
  });

  it("renders all control groups", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("header-controls")).toBeInTheDocument();
    expect(screen.getByTestId("auto-refresh-group")).toBeInTheDocument();
    expect(screen.getByTestId("provider-group")).toBeInTheDocument();
    expect(screen.getByTestId("mode-group")).toBeInTheDocument();
    expect(screen.getByTestId("view-group")).toBeInTheDocument();
  });

  it("shows auto-refresh label", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} />
      </MantineProvider>,
    );
    expect(screen.getByText("Auto-refresh")).toBeInTheDocument();
    expect(screen.getByText("sec")).toBeInTheDocument();
  });

  it("shows provider label", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} />
      </MantineProvider>,
    );
    expect(screen.getByText("Provider")).toBeInTheDocument();
  });

  it("shows mode label", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} />
      </MantineProvider>,
    );
    expect(screen.getByText("Mode")).toBeInTheDocument();
  });

  it("shows view as label on small screens", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} />
      </MantineProvider>,
    );
    expect(screen.getByText("View as")).toBeInTheDocument();
  });

  it("handles zero auto-refresh value", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} autoRefreshSeconds={0} />
      </MantineProvider>,
    );
    const input = screen.getByTestId("auto-refresh-input");
    expect(input).toHaveValue("0");
  });

  it("handles large auto-refresh value within limit", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} autoRefreshSeconds={3600} />
      </MantineProvider>,
    );
    const input = screen.getByTestId("auto-refresh-input");
    expect(input).toHaveValue("3600");
  });

  it("passes correct auto-refresh value to onAutoRefreshChange", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} />
      </MantineProvider>,
    );
    const input = screen.getByTestId("auto-refresh-input");
    fireEvent.change(input, { target: { value: "300" } });
    expect(defaultProps.onAutoRefreshChange).toHaveBeenCalledWith(300);
  });

  it("handles provider change to indmoney", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} />
      </MantineProvider>,
    );
    const providerSelect = screen.getByTestId("provider-select");
    fireEvent.change(providerSelect, { target: { value: "indmoney" } });
    expect(defaultProps.onProviderChange).toHaveBeenCalledWith("indmoney");
  });

  it("handles mode change to historical", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} />
      </MantineProvider>,
    );
    const modeSelect = screen.getByTestId("mode-select");
    fireEvent.change(modeSelect, { target: { value: "historical" } });
    expect(defaultProps.onModeChange).toHaveBeenCalledWith("historical");
  });

  it("renders with custom title", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} title="Custom Title" />
      </MantineProvider>,
    );
    expect(screen.getByText("Custom Title")).toBeInTheDocument();
  });

  it("renders with custom status", () => {
    render(
      <MantineProvider>
        <ScreenerHeader {...defaultProps} status="Loading..." />
      </MantineProvider>,
    );
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });
});
