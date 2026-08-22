// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import { StrategyForm } from "./StrategyForm";
import type { StrategyConfig } from "../../types/strategies";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

vi.mock("@/ui", async () => {
  const core = await vi.importActual<typeof import("@mantine/core")>("@mantine/core");
  const ui = await vi.importActual<typeof import("@/ui")>("@/ui");
  return {
    ...core,
    UIProvider: ui.UIProvider,
    useDebouncedValue: ui.useDebouncedValue,
    Select: ({ onChange, data, "data-testid": testId, ...rest }: any) => (
      <select
        data-testid={testId}
        onChange={(e) => onChange?.(e.target.value)}
        {...rest}
      >
        {data?.map((opt: any) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    ) };
});

beforeEach(() => {
  window.alert = vi.fn();
});

afterEach(() => {
  cleanup();

  vi.clearAllMocks();
});

const makeTemplate = (overrides: Partial<StrategyConfig> = {}): StrategyConfig => ({
  id: "1", internal_id: 1, name: "ORB Template", strategy_type: "ORB",
  parent_id: null, is_template: true, is_active: true, is_default: true,
  description: null, or_minutes: 15, sl_pct: 1, tp_pct: 1.5,
  min_or_range_pct: 0.3, max_or_range_pct: 2, max_positions: 3,
  max_capital_per_trade_pct: 20, max_daily_loss_pct: 5,
  max_total_exposure_pct: 50, risk_per_trade_pct: 2,
  min_trade_value: 5000, max_trade_value: 100000,
  cooldown_minutes: 30, max_distance_from_or_pct: 1.5,
  entry_threshold_pct: 3, enable_trailing_stop: false,
  trailing_stop_pct: 3, trailing_activation_pct: 2,
  max_holding_days: 30, cooldown_days: 30, enable_filters: false,
  ema_fast_period: 9, ema_slow_period: 21,
  pivot_type: "classic", breakout_buffer_pct: 0.1,
  screener_profiles: [],
  custom_watchlist: [],
  brokerage_pct: 0.03, min_brokerage: 20, stt_pct: 0.025,
  exchange_pct: 0.003, sebi_pct: 0.0001, stamp_pct: 0.003,
  gst_pct: 18, created_at: null, updated_at: null,
  ...overrides });

const baseProps = {
  mode: "create" as const,
  template: null,
  opened: true,
  onClose: vi.fn(),
  onSubmit: vi.fn(),
  isBotRunning: false };

describe("StrategyForm", () => {
  it("renders modal with data-testid", () => {
    render(
      <UIProvider>
        <StrategyForm {...baseProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategy-form-modal")).toBeInTheDocument();
  });

  it("shows Create Strategy title", () => {
    render(
      <UIProvider>
        <StrategyForm {...baseProps} />
      </UIProvider>,
    );
    expect(screen.getByText("Create Strategy")).toBeInTheDocument();
  });

  it("shows Edit Strategy title in edit mode", () => {
    render(
      <UIProvider>
        <StrategyForm {...baseProps} mode="edit" />
      </UIProvider>,
    );
    expect(screen.getByText("Edit Strategy")).toBeInTheDocument();
  });

  it("renders form with data-testid", () => {
    render(
      <UIProvider>
        <StrategyForm {...baseProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategy-form")).toBeInTheDocument();
  });

  it("renders Strategy Name input", () => {
    render(
      <UIProvider>
        <StrategyForm {...baseProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategy-name-input")).toBeInTheDocument();
  });

  it("renders Strategy Type select (enabled in create mode)", () => {
    render(
      <UIProvider>
        <StrategyForm {...baseProps} />
      </UIProvider>,
    );
    const typeInput = screen.getByTestId("strategy-type-input");
    expect(typeInput).toBeInTheDocument();
    expect(typeInput).not.toBeDisabled();
  });

  it("renders Strategy Type select (disabled in edit mode)", () => {
    render(
      <UIProvider>
        <StrategyForm {...baseProps} mode="edit" />
      </UIProvider>,
    );
    const typeInput = screen.getByTestId("strategy-type-input");
    expect(typeInput).toBeDisabled();
  });

  it("renders Description input", () => {
    render(
      <UIProvider>
        <StrategyForm {...baseProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategy-description-input")).toBeInTheDocument();
  });

  it("renders Screener Profiles MultiSelect", () => {
    render(
      <UIProvider>
        <StrategyForm {...baseProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategy-screener-profiles")).toBeInTheDocument();
  });

  it("renders Custom Stocks MultiSelect", () => {
    render(
      <UIProvider>
        <StrategyForm {...baseProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategy-custom-watchlist")).toBeInTheDocument();
  });

  it("renders form tabs", () => {
    render(
      <UIProvider>
        <StrategyForm {...baseProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategy-form-tabs")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-form-tabs-list")).toBeInTheDocument();
  });

  it("renders ORB tab visible for ORB type", () => {
    render(
      <UIProvider>
        <StrategyForm {...baseProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategy-tab-orb")).toBeInTheDocument();
  });

  it("Sizing tab always visible", () => {
    render(
      <UIProvider>
        <StrategyForm {...baseProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategy-tab-risk")).toBeInTheDocument();
  });

  it("Execution tab always visible", () => {
    render(
      <UIProvider>
        <StrategyForm {...baseProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategy-tab-runner")).toBeInTheDocument();
  });

  it("renders Cancel and Submit buttons", () => {
    render(
      <UIProvider>
        <StrategyForm {...baseProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategy-cancel-btn")).toBeInTheDocument();
    expect(screen.getByTestId("submit-strategy-btn")).toBeInTheDocument();
  });

  it("submit button shows Create or Save text based on mode", () => {
    render(
      <UIProvider>
        <StrategyForm {...baseProps} />
      </UIProvider>,
    );
    expect(screen.getByText("Create")).toBeInTheDocument();
  });

  it("submit button shows Save in edit mode", () => {
    render(
      <UIProvider>
        <StrategyForm {...baseProps} mode="edit" />
      </UIProvider>,
    );
    expect(screen.getByText("Save")).toBeInTheDocument();
  });

  it("Cancel button closes modal", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <UIProvider>
        <StrategyForm {...baseProps} onClose={onClose} />
      </UIProvider>,
    );
    await user.click(screen.getByTestId("strategy-cancel-btn"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders restart warning alert in edit mode with bot running", () => {
    render(
      <UIProvider>
        <StrategyForm {...baseProps} mode="edit" isBotRunning={true} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategy-form-restart-warning")).toBeInTheDocument();
  });

  it("renders template info alert when template provided", () => {
    const template: StrategyConfig = {
      id: "1", internal_id: 1, name: "ORB Template", strategy_type: "ORB",
      parent_id: null, is_template: true, is_active: true, is_default: true,
      description: null, or_minutes: 15, sl_pct: 1, tp_pct: 1.5,
      min_or_range_pct: 0.3, max_or_range_pct: 2, max_positions: 3,
      max_capital_per_trade_pct: 20, max_daily_loss_pct: 5,
      max_total_exposure_pct: 50, risk_per_trade_pct: 2,
      min_trade_value: 5000, max_trade_value: 100000,
      cooldown_minutes: 30, max_distance_from_or_pct: 1.5,
      entry_threshold_pct: 3, enable_trailing_stop: false,
      trailing_stop_pct: 3, trailing_activation_pct: 2,
      max_holding_days: 30, cooldown_days: 30, enable_filters: false,
      ema_fast_period: 9, ema_slow_period: 21,
      pivot_type: "classic", breakout_buffer_pct: 0.1,
      screener_profiles: [],
      brokerage_pct: 0.03, min_brokerage: 20, stt_pct: 0.025,
      exchange_pct: 0.003, sebi_pct: 0.0001, stamp_pct: 0.003,
      gst_pct: 18, created_at: null, updated_at: null };
    render(
      <UIProvider>
        <StrategyForm {...baseProps} template={template} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategy-form-template-info")).toBeInTheDocument();
    expect(screen.getByText(/ORB Template/)).toBeInTheDocument();
  });

  it("validates EMA fast period must be less than slow period", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const template = makeTemplate({
      strategy_type: "EMA_CROSS",
      ema_fast_period: 21,
      ema_slow_period: 9 });
    render(
      <UIProvider>
        <StrategyForm {...baseProps} template={template} onSubmit={onSubmit} />
      </UIProvider>,
    );
    await user.click(screen.getByTestId("submit-strategy-btn"));
    expect(window.alert).toHaveBeenCalledWith("Fast EMA period must be less than Slow EMA period");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("allows submit when EMA fast < slow", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const template = makeTemplate({
      strategy_type: "EMA_CROSS",
      ema_fast_period: 9,
      ema_slow_period: 21 });
    render(
      <UIProvider>
        <StrategyForm {...baseProps} template={template} onSubmit={onSubmit} />
      </UIProvider>,
    );
    await user.click(screen.getByTestId("submit-strategy-btn"));
    expect(window.alert).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("shows correct tab panel for strategy type from template", () => {
    const emaTemplate = makeTemplate({ strategy_type: "EMA_CROSS" });
    const { unmount } = render(
      <UIProvider>
        <StrategyForm {...baseProps} template={emaTemplate} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategy-tab-ema")).toBeInTheDocument();
    expect(screen.queryByTestId("strategy-tab-orb")).not.toBeInTheDocument();
    unmount();
    const orbTemplate = makeTemplate({ strategy_type: "ORB" });
    render(
      <UIProvider>
        <StrategyForm {...baseProps} template={orbTemplate} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategy-tab-orb")).toBeInTheDocument();
  });

  it("calls onSubmit with form data on submit", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const template = makeTemplate({
      name: "My Template",
      strategy_type: "ORB",
      or_minutes: 15,
      sl_pct: 2,
      tp_pct: 3,
      screener_profiles: [] });
    render(
      <UIProvider>
        <StrategyForm {...baseProps} template={template} onSubmit={onSubmit} />
      </UIProvider>,
    );
    await user.click(screen.getByTestId("submit-strategy-btn"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const data = onSubmit.mock.calls[0][0];
    expect(data.name).toBe("My Template - Custom");
    expect(data.strategy_type).toBe("ORB");
  });

  it("shows Execution tab and RunnerPanel", () => {
    const template = makeTemplate();
    render(
      <UIProvider>
        <StrategyForm {...baseProps} template={template} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategy-tab-runner")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-panel-runner")).toBeInTheDocument();
  });

  it("shows S/R Breakout tab for SR_BREAKOUT type", () => {
    const template = makeTemplate({ strategy_type: "SR_BREAKOUT" });
    render(
      <UIProvider>
        <StrategyForm {...baseProps} template={template} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategy-tab-sr")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-panel-sr")).toBeInTheDocument();
  });

  it("shows 52W Params tab for 52W_CHASER type", () => {
    const template = makeTemplate({ strategy_type: "52W_CHASER" });
    render(
      <UIProvider>
        <StrategyForm {...baseProps} template={template} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategy-tab-52w")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-panel-52w")).toBeInTheDocument();
  });

  it("shows 52W Params tab for 52W_TARGET type", () => {
    const template = makeTemplate({ strategy_type: "52W_TARGET" });
    render(
      <UIProvider>
        <StrategyForm {...baseProps} template={template} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategy-tab-52w")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-panel-52w")).toBeInTheDocument();
  });

  it("shows EMA params panel with Fast/Slow period inputs for EMA_CROSS type", () => {
    const template = makeTemplate({ strategy_type: "EMA_CROSS" });
    render(
      <UIProvider>
        <StrategyForm {...baseProps} template={template} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategy-tab-ema")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-panel-ema")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-ema-fast-period-input")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-ema-slow-period-input")).toBeInTheDocument();
  });

  it("shows Swing params panel with entry threshold, trailing stop, holding days, cooldown days for 52W_CHASER type", () => {
    const template = makeTemplate({ strategy_type: "52W_CHASER" });
    render(
      <UIProvider>
        <StrategyForm {...baseProps} template={template} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategy-panel-52w")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-entry-threshold-input")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-trailing-stop-input")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-max-holding-input")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-cooldown-days-input")).toBeInTheDocument();
  });

  it("shows Swing params panel with all inputs for 52W_TARGET type", () => {
    const template = makeTemplate({ strategy_type: "52W_TARGET" });
    render(
      <UIProvider>
        <StrategyForm {...baseProps} template={template} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategy-panel-52w")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-entry-threshold-input")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-trailing-stop-input")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-max-holding-input")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-cooldown-days-input")).toBeInTheDocument();
  });

  it("changes active tab when strategy type is changed via Select", async () => {
    const user = userEvent.setup();
    render(
      <UIProvider>
        <StrategyForm {...baseProps} template={makeTemplate({ strategy_type: "ORB" })} />
      </UIProvider>,
    );
    expect(screen.getByTestId("strategy-tab-orb")).toBeInTheDocument();
    expect(screen.queryByTestId("strategy-tab-sr")).not.toBeInTheDocument();
    const select = screen.getByTestId("strategy-type-input");
    await user.selectOptions(select, "SR_BREAKOUT");
    expect(screen.getByTestId("strategy-tab-sr")).toBeInTheDocument();
    expect(screen.queryByTestId("strategy-tab-orb")).not.toBeInTheDocument();
  });
});
