/**
 * Design Patterns index
 *
 * This barrel re-exports all 12 GoF pattern implementations.
 * Each pattern lives in its own subdirectory with a dedicated
 * implementation file and a companion README.md documenting it.
 *
 * Category A — Integrated into existing code:
 *   1. Singleton  → StoreRegistry     (src/state/StoreRegistry.ts concept)
 *   2. Factory    → StrategyParamPanelFactory
 *   3. Observer   → EventBus
 *   4. Strategy   → ParamValidationStrategy
 *   5. State      → BotStateMachine
 *
 * Category B — Standalone learning examples:
 *   6. Builder    → ChartOptionBuilder
 *   7. Adapter    → DataAdapter
 *   8. Decorator  → ApiDecorators
 *   9. Proxy      → StateProxy
 *  10. Facade     → TradingFacade
 *  11. Command    → TradeCommand
 *  12. Iterator   → DataIterator
 */

// ── Creational ──────────────────────────────────────────────────────────
export { StoreRegistry } from "./singleton/StoreRegistry";
export type { ScreenerStore, AuthStore, StoreName, StoreMap } from "./singleton/StoreRegistry";

export { StrategyParamPanelFactory, StrategyParamPanel } from "./factory/StrategyParamPanelFactory";

export { ChartOptionBuilder } from "./builder/ChartOptionBuilder";

// ── Structural ──────────────────────────────────────────────────────────
export { PaperCandleAdapter, PositionAdapter, TradeAdapter, DataAdapterFactory } from "./adapter/DataAdapter";
export type { NormalizedCandle, NormalizedPosition, NormalizedTrade, DataAdapter } from "./adapter/DataAdapter";

export { SimpleCache, withRetry, withCache, withLogging, withDedup, createCompositeDecorator } from "./decorator/ApiDecorators";
export type { ApiFn } from "./decorator/ApiDecorators";

export { LazyStateProxy, createBotStateProxy, createPositionsProxy, isLoaded } from "./proxy/StateProxy";

export { TradingFacade } from "./facade/TradingFacade";
export type { DashboardData, DashboardResult, TradingApiClient } from "./facade/TradingFacade";

// ── Behavioral ──────────────────────────────────────────────────────────
export { EventBus, eventBus } from "./observer/EventBus";
export type { AppEvents } from "./observer/EventBus";

export {
  ORBValidationStrategy,
  SRBreakoutValidationStrategy,
  EMACrossValidationStrategy,
  SwingValidationStrategy,
  ValidationStrategyRegistry,
} from "./strategy/ParamValidationStrategy";
export type { ValidationResult, ParamValidationStrategy } from "./strategy/ParamValidationStrategy";

export { BotStateMachine, BotState, BotEvent } from "./state/BotStateMachine";
export type { StateTransition } from "./state/BotStateMachine";

export { CommandHistory, ClosePositionCommand, ModifyStopLossCommand, ModifyTakeProfitCommand, BatchCloseCommand } from "./command/TradeCommand";
export type { Command } from "./command/TradeCommand";

export { PaginatedIterator, ArrayIterator, createTradeIterator } from "./iterator/DataIterator";
export type { Page, IteratorResult, FetchPageFn } from "./iterator/DataIterator";
