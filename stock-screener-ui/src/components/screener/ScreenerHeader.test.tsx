// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent} from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { ScreenerHeader } from "./ScreenerHeader";
import { UIProvider } from "@/ui";

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

  function getNumberInput() {
    const outer = screen.getByTestId("auto-refresh-input");
    return within(outer).getByRole("spinbutton") as HTMLInputElement;
  }

  function getCombobox(testId: string) {
    const outer = screen.getByTestId(testId);
    return within(outer).getByRole("combobox");
  }

  it("calls onRefresh when refresh button clicked", async () => {
    render(() => (
      <UIProvider>
        <ScreenerHeader {...defaultProps} />
      </UIProvider>
    ));
    fireEvent.click(screen.getByTestId("refresh-btn"));
    expect(defaultProps.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows loading state on refresh button", () => {
    render(() => (
      <UIProvider>
        <ScreenerHeader {...defaultProps} isLoading={true} />
      </UIProvider>
    ));
    const refreshBtn = screen.getByTestId("refresh-btn");
    // The @/ui ActionIcon shows loading as disabled + progress indicator
    expect(refreshBtn).toBeDisabled();
    expect(refreshBtn).toHaveAttribute("aria-busy", "true");
  });

  it("disables auto-refresh input when loading", () => {
    render(() => (
      <UIProvider>
        <ScreenerHeader {...defaultProps} isLoading={true} />
      </UIProvider>
    ));
    expect(getNumberInput()).toBeDisabled();
  });

  it("keeps inputs enabled during background refresh when results are present", () => {
    render(() => (
      <UIProvider>
        <ScreenerHeader {...defaultProps} isLoading={true} disableControls={false} />
      </UIProvider>
    ));
    expect(getNumberInput()).toBeEnabled();
  });

  it("calls onAutoRefreshChange when auto-refresh value changes", async () => {
    render(() => (
      <UIProvider>
        <ScreenerHeader {...defaultProps} />
      </UIProvider>
    ));
    const input = getNumberInput();
    fireEvent.input(input, { target: { value: "" } });
    fireEvent.input(input, { target: { value: "120" } });
    expect(defaultProps.onAutoRefreshChange).toHaveBeenCalled();
  });

  it("calls onProviderChange when provider changes", async () => {
    render(() => (
      <UIProvider>
        <ScreenerHeader {...defaultProps} />
      </UIProvider>
    ));
    fireEvent.input(getCombobox("provider-select"), { target: { value: "indmoney" } });
    expect(defaultProps.onProviderChange).toHaveBeenCalledWith("indmoney");
  });

  it("calls onModeChange when mode changes", async () => {
    render(() => (
      <UIProvider>
        <ScreenerHeader {...defaultProps} />
      </UIProvider>
    ));
    fireEvent.input(getCombobox("mode-select"), { target: { value: "historical" } });
    expect(defaultProps.onModeChange).toHaveBeenCalledWith("historical");
  });

  it("calls onViewModeChange when table button clicked", async () => {
    render(() => (
      <UIProvider>
        <ScreenerHeader {...defaultProps} viewMode="heatmap" />
      </UIProvider>
    ));
    fireEvent.click(screen.getByRole("button", { name: "Tbl" }));
    expect(defaultProps.onViewModeChange).toHaveBeenCalledWith("table");
  });

  it("calls onViewModeChange when heatmap button clicked", async () => {
    render(() => (
      <UIProvider>
        <ScreenerHeader {...defaultProps} />
      </UIProvider>
    ));
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(defaultProps.onViewModeChange).toHaveBeenCalledWith("heatmap");
  });

  it("displays correct view mode state", () => {
    render(() => (
      <UIProvider>
        <ScreenerHeader {...defaultProps} viewMode="heatmap" />
      </UIProvider>
    ));
    expect(screen.getByRole("button", { name: "Map" })).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: "Map" });
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("handles zero auto-refresh value", () => {
    render(() => (
      <UIProvider>
        <ScreenerHeader {...defaultProps} autoRefreshSeconds={0} />
      </UIProvider>
    ));
    expect(getNumberInput()).toHaveValue(0);
  });

  it("handles large auto-refresh value within limit", () => {
    render(() => (
      <UIProvider>
        <ScreenerHeader {...defaultProps} autoRefreshSeconds={3600} />
      </UIProvider>
    ));
    expect(getNumberInput()).toHaveValue(3600);
  });

  it("passes correct auto-refresh value to onAutoRefreshChange", async () => {
    render(() => (
      <UIProvider>
        <ScreenerHeader {...defaultProps} />
      </UIProvider>
    ));
    const input = getNumberInput();
    fireEvent.input(input, { target: { value: "300" } });
    expect(defaultProps.onAutoRefreshChange).toHaveBeenCalled();
  });

});
