/**
 * GoF Adapter Pattern — Normalize heterogeneous API response shapes.
 *
 * ░─ PROBLEM ──────────────────────────────────────────────────────────
 * The codebase has duplicated CandleData interfaces across three files
 * (backtest.ts, paperTrading.ts, replay.ts) with slightly different field
 * sets. API responses mix snake_case and camelCase. Position/trade
 * objects vary between endpoints.
 *
 * ░─ SOLUTION ─────────────────────────────────────────────────────────
 * Each concrete adapter knows one source format and maps it to a single
 * target (normalized) interface. Consumers depend only on the target,
 * not on which upstream endpoint produced the data.
 *
 * ┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
 * │  Backend API  │ ──> │ PaperCandleAdapter│ ──> │ NormalizedCandle │
 * │  (snake_case) │     │ PositionAdapter  │     │ NormalizedPosition│
 * │  (camelCase)  │     │ TradeAdapter     │     │ NormalizedTrade  │
 * └──────────────┘     └──────────────────┘     └──────────────────┘
 *
 * @module patterns/adapter
 */

/* ─── TARGET (normalized) interfaces ──────────────────────────────── */

export interface NormalizedCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface NormalizedPosition {
  symbol: string;
  side: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
  stopLoss: number;
  takeProfit: number;
}

export interface NormalizedTrade {
  tradeId: string;
  symbol: string;
  side: string;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  entryTime: string;
  exitTime: string;
  pnl: number;
  pnlPct: number;
  exitReason: string;
  costs: number;
}

/* ─── ADAPTER INTERFACE ───────────────────────────────────────────── */

export interface DataAdapter<T, R> {
  adapt(source: T): R;
  adaptMany(sources: T[]): R[];
}

/* ─── CONCRETE ADAPTERS ───────────────────────────────────────────── */

/**
 * Adapts candle data from any known source format (paper, backtest, replay)
 * into a uniform {@link NormalizedCandle}.
 *
 * Handles two source shapes:
 * 1. `{ time, open, high, low, close, volume }` — PaperTrading & Replay
 * 2. `{ time, date, time_str, open, high, low, close, volume }` — Backtest
 */
export class PaperCandleAdapter implements DataAdapter<any, NormalizedCandle> {
  /** @inheritdoc */
  adapt(source: any): NormalizedCandle {
    if (!source) {
      return { time: "", open: 0, high: 0, low: 0, close: 0, volume: 0 };
    }

    const time = this._resolveTime(source);

    return {
      time: time ?? "",
      open: source.open ?? 0,
      high: source.high ?? 0,
      low: source.low ?? 0,
      close: source.close ?? 0,
      volume: source.volume ?? 0,
    };
  }

  /** @inheritdoc */
  adaptMany(sources: any[]): NormalizedCandle[] {
    if (!sources || !Array.isArray(sources)) return [];
    return sources.map((s) => this.adapt(s));
  }

  /**
   * Resolve the `time` field from any candle shape.
   *
   * Priority: `time` → `date` + `time_str` → `timestamp` → `date` → `""`
   */
  private _resolveTime(source: Record<string, any>): string {
    if (source.time) return source.time;
    if (source.date && source.time_str) return `${source.date}T${source.time_str}`;
    if (source.timestamp) return source.timestamp;
    if (source.date) return source.date;
    return "";
  }
}

/**
 * Adapts {@link PaperPosition} (and structurally similar position objects)
 * into a uniform {@link NormalizedPosition}.
 *
 * Handles both snake_case (`stop_loss`) and camelCase (`stopLoss`) input fields.
 */
export class PositionAdapter implements DataAdapter<any, NormalizedPosition> {
  /** @inheritdoc */
  adapt(source: any): NormalizedPosition {
    if (!source) {
      return {
        symbol: "",
        side: "",
        quantity: 0,
        entryPrice: 0,
        currentPrice: 0,
        pnl: 0,
        pnlPct: 0,
        stopLoss: 0,
        takeProfit: 0,
      };
    }

    return {
      symbol: source.symbol ?? "",
      side: source.side ?? "",
      quantity: source.quantity ?? 0,
      entryPrice: source.entry_price ?? source.entryPrice ?? 0,
      currentPrice: source.current_price ?? source.currentPrice ?? 0,
      pnl: source.pnl ?? 0,
      pnlPct: source.pnl_pct ?? source.pnlPct ?? 0,
      stopLoss: source.stop_loss ?? source.stopLoss ?? 0,
      takeProfit: source.take_profit ?? source.takeProfit ?? 0,
    };
  }

  /** @inheritdoc */
  adaptMany(sources: any[]): NormalizedPosition[] {
    if (!sources || !Array.isArray(sources)) return [];
    return sources.map((s) => this.adapt(s));
  }
}

/**
 * Adapts {@link PaperTrade} (and structurally similar trade objects)
 * into a uniform {@link NormalizedTrade}.
 *
 * Handles both `trade_id` / `tradeId` and `exit_reason` / `exitReason` naming.
 */
export class TradeAdapter implements DataAdapter<any, NormalizedTrade> {
  /** @inheritdoc */
  adapt(source: any): NormalizedTrade {
    if (!source) {
      return {
        tradeId: "",
        symbol: "",
        side: "",
        quantity: 0,
        entryPrice: 0,
        exitPrice: 0,
        entryTime: "",
        exitTime: "",
        pnl: 0,
        pnlPct: 0,
        exitReason: "",
        costs: 0,
      };
    }

    return {
      tradeId: source.trade_id ?? source.tradeId ?? "",
      symbol: source.symbol ?? "",
      side: source.side ?? "",
      quantity: source.quantity ?? 0,
      entryPrice: source.entry_price ?? source.entryPrice ?? 0,
      exitPrice: source.exit_price ?? source.exitPrice ?? 0,
      entryTime: source.entry_time ?? source.entryTime ?? "",
      exitTime: source.exit_time ?? source.exitTime ?? "",
      pnl: source.pnl ?? 0,
      pnlPct: source.pnl_pct ?? source.pnlPct ?? 0,
      exitReason: source.exit_reason ?? source.exitReason ?? "",
      costs: source.costs ?? 0,
    };
  }

  /** @inheritdoc */
  adaptMany(sources: any[]): NormalizedTrade[] {
    if (!sources || !Array.isArray(sources)) return [];
    return sources.map((s) => this.adapt(s));
  }
}

/* ─── FACTORY / REGISTRY ──────────────────────────────────────────── */

type AdapterKey = "candle" | "position" | "trade";

/**
 * Registry that returns the correct adapter for a given data type.
 *
 * Usage:
 * ```ts
 * const adapter = DataAdapterFactory.getAdapter("candle");
 * const normalized = adapter.adapt(backendCandle);
 * ```
 */
export class DataAdapterFactory {
  private static instances = new Map<AdapterKey, DataAdapter<any, any>>();

  private static init(): void {
    if (DataAdapterFactory.instances.size > 0) return;
    DataAdapterFactory.instances.set("candle", new PaperCandleAdapter());
    DataAdapterFactory.instances.set("position", new PositionAdapter());
    DataAdapterFactory.instances.set("trade", new TradeAdapter());
  }

  /**
   * Return the singleton adapter for the given type key.
   *
   * @param type — One of `"candle"`, `"position"`, `"trade"`
   * @throws {Error} If the type key is unknown.
   */
  static getAdapter(type: AdapterKey): DataAdapter<any, any> {
    DataAdapterFactory.init();
    const adapter = DataAdapterFactory.instances.get(type);
    if (!adapter) {
      throw new Error(`DataAdapterFactory: unknown adapter type "${type}"`);
    }
    return adapter;
  }

  /** Register or override an adapter at runtime. */
  static register(type: AdapterKey, adapter: DataAdapter<any, any>): void {
    DataAdapterFactory.instances.set(type, adapter);
  }

  /** Clear all cached adapters (useful in tests). */
  static reset(): void {
    DataAdapterFactory.instances.clear();
  }
}
