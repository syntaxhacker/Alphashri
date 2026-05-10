// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { StrategiesPage } from "./StrategiesPage";
import type { StrategiesPageProps } from "./types";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

afterEach(() => {
  cleanup();
});

const baseProps: StrategiesPageProps = {
  strategies: [],
  templates: [],
  performance: [],
  bots: [],
  isLoading: false,
  error: null,
  activeView: "tree",
  showCreateModal: false,
  showEditModal: false,
  editingStrategy: null,
  parentTemplate: null,
  onViewChange: vi.fn(),
  onCreateStrategy: vi.fn(),
  onEditStrategy: vi.fn(),
  onDeleteStrategy: vi.fn(),
  onOpenCreateModal: vi.fn(),
  onOpenEditModal: vi.fn(),
  onCloseCreateModal: vi.fn(),
  onCloseEditModal: vi.fn(),
  onCreateFromTemplate: vi.fn(),
  onEditTemplate: vi.fn(),
  onSyncVariations: vi.fn(),
  onSelectStrategy: vi.fn(),
  onUpdate: vi.fn().mockResolvedValue(undefined),
  onRefresh: vi.fn(),
  onClearError: vi.fn(),
  isAnyBotRunning: false,
};

describe("StrategiesPage", () => {
  it("renders with data-testid", () => {
    render(
      <MantineProvider>
        <StrategiesPage {...baseProps} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("strategies-view")).toBeInTheDocument();
  });

  it("renders nav container", () => {
    render(
      <MantineProvider>
        <StrategiesPage {...baseProps} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("strategies-nav-container")).toBeInTheDocument();
  });

  it("renders content area", () => {
    render(
      <MantineProvider>
        <StrategiesPage {...baseProps} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("strategies-content")).toBeInTheDocument();
  });

  it("shows error state with Retry and Dismiss buttons", () => {
    render(
      <MantineProvider>
        <StrategiesPage {...baseProps} error="Something went wrong" />
      </MantineProvider>,
    );
    expect(screen.getByTestId("strategies-error")).toBeInTheDocument();
    expect(screen.getByTestId("strategies-retry-btn")).toBeInTheDocument();
    expect(screen.getByTestId("strategies-dismiss-btn")).toBeInTheDocument();
  });

  it("Retry button calls onRefresh", async () => {
    const onRefresh = vi.fn();
    const user = userEvent.setup();
    render(
      <MantineProvider>
        <StrategiesPage {...baseProps} error="Error" onRefresh={onRefresh} />
      </MantineProvider>,
    );
    await user.click(screen.getByTestId("strategies-retry-btn"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("Dismiss button calls onClearError", async () => {
    const onClearError = vi.fn();
    const user = userEvent.setup();
    render(
      <MantineProvider>
        <StrategiesPage {...baseProps} error="Error" onClearError={onClearError} />
      </MantineProvider>,
    );
    await user.click(screen.getByTestId("strategies-dismiss-btn"));
    expect(onClearError).toHaveBeenCalledTimes(1);
  });

  it("active view 'tree' renders TemplateTreeView", () => {
    render(
      <MantineProvider>
        <StrategiesPage {...baseProps} activeView="tree" />
      </MantineProvider>,
    );
    expect(screen.getByTestId("template-tree-empty")).toBeInTheDocument();
  });

  it("active view 'performance' renders PerformanceView", () => {
    render(
      <MantineProvider>
        <StrategiesPage {...baseProps} activeView="performance" />
      </MantineProvider>,
    );
    expect(screen.getByTestId("performance-empty-state")).toBeInTheDocument();
  });

  it("renders create modal when showCreateModal is true", () => {
    render(
      <MantineProvider>
        <StrategiesPage {...baseProps} showCreateModal={true} />
      </MantineProvider>,
    );
    const modals = screen.getAllByTestId("strategy-form-modal");
    expect(modals.length).toBeGreaterThanOrEqual(1);
  });

  it("renders edit modal when showEditModal is true", () => {
    render(
      <MantineProvider>
        <StrategiesPage
          {...baseProps}
          showEditModal={true}
          editingStrategy={{
            id: "1", internal_id: 1, name: "Test", strategy_type: "ORB",
            parent_id: null, is_template: false, is_active: true, is_default: false,
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
            gst_pct: 18, created_at: null, updated_at: null,
          }}
        />
      </MantineProvider>,
    );
    const modals = screen.getAllByTestId("strategy-form-modal");
    expect(modals.length).toBeGreaterThanOrEqual(1);
  });
});
