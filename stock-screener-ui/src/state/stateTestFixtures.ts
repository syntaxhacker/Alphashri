// Shared builders/sandboxes for the state store test suites. Test-only.
import { beforeEach, afterEach, expect, vi } from "vitest";
import type { StrategyConfig } from "../types/strategies";
import type { BotConfig } from "../types/bots";
import type { ReplayTrade, ReplayOpenPosition } from "../types/replay";

export function createMockStrategy(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
  return {
    id: "uuid-1",
    internal_id: 1,
    name: "ORB Strategy",
    strategy_type: "orb",
    parent_id: null,
    is_template: false,
    is_active: true,
    is_default: true,
    description: null,
    or_minutes: 45,
    sl_pct: 0.5,
    tp_pct: 1.5,
    min_or_range_pct: 0.2,
    max_or_range_pct: 5,
    max_positions: 5,
    max_capital_per_trade_pct: 20,
    max_daily_loss_pct: 3,
    max_total_exposure_pct: 80,
    risk_per_trade_pct: 2,
    min_trade_value: 5000,
    max_trade_value: 50000,
    cooldown_minutes: 30,
    max_distance_from_or_pct: 2,
    entry_threshold_pct: 0,
    min_breakout_pct: 0,
    near_high_threshold_pct: 0,
    min_days_since_52w_high: 0,
    enable_trailing_stop: false,
    trailing_stop_pct: 0,
    trailing_activation_pct: 0,
    max_holding_days: 0,
    cooldown_days: 0,
    enable_filters: false,
    ema_fast_period: 0,
    ema_slow_period: 0,
    pivot_type: "",
    breakout_buffer_pct: 0,
    brokerage_pct: 0.03,
    min_brokerage: 20,
    stt_pct: 0.1,
    exchange_pct: 0.00345,
    sebi_pct: 0.0001,
    stamp_pct: 0.003,
    gst_pct: 18,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

export function createMockBot(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    id: "bot-uuid-1",
    uuid: "bot-uuid-1",
    name: "Test Bot",
    is_active: true,
    max_total_positions: 10,
    max_total_capital_pct: 80,
    max_daily_loss_pct: 5,
    live_trading: false,
    strategies: [],
    created_at: null,
    updated_at: null,
    running: false,
    pid: null,
    ...overrides,
  };
}

// beforeEach fake timers + afterEach restore/cleanup used by every bots describe block.
export function fakeTimersSandbox() {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
}

// beforeEach/afterEach restoreAllMocks used by every strategies describe block.
export function restoreSandbox() {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
}

export function expectSubscribeReturnsUnsubscribe(subscribe: (cb: () => void) => () => void) {
  const unsub = subscribe(vi.fn());
  expect(typeof unsub).toBe("function");
  unsub();
}

export function expectTriggerRerenderNotifies(
  subscribe: (cb: () => void) => () => void,
  triggerRerender: () => void,
) {
  const cb = vi.fn();
  const unsub = subscribe(cb);
  triggerRerender();
  expect(cb).toHaveBeenCalledTimes(1);
  unsub();
}

// Replay trade/position inputs matching the replay SSE payloads (id is assigned by the store).
export const makeReplayTradeInput = (
  overrides: Partial<Omit<ReplayTrade, "id">> = {},
): Omit<ReplayTrade, "id"> =>
  ({
    symbol: "TCS",
    strategy: "ORB",
    side: "LONG",
    entry_price: 100,
    exit_price: 110,
    pnl: 10,
    exit_reason: "TP",
    ...overrides,
  }) as unknown as Omit<ReplayTrade, "id">;

export const makeOpenPositionInput = (
  overrides: Partial<Omit<ReplayOpenPosition, "id">> = {},
): Omit<ReplayOpenPosition, "id"> =>
  ({
    symbol: "TCS",
    strategy: "ORB",
    side: "LONG",
    entry_price: 100,
    sl: 90,
    tp: 110,
    entry_time: "09:15",
    quantity: 100,
    ...overrides,
  }) as unknown as Omit<ReplayOpenPosition, "id">;
