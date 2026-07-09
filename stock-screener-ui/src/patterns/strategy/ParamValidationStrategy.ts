/**
 * Strategy Pattern — ParamValidationStrategy
 *
 * Intent: Define a family of validation algorithms for different strategy types,
 * encapsulate each one, and make them interchangeable via a registry.
 *
 * Each strategy type (ORB, SR_BREAKOUT, EMA_CROSS, 52W_CHASER, 52W_TARGET) has
 * distinct parameters and validation rules. The Strategy pattern extracts this
 * scattered validation logic from StrategyForm.tsx into focused strategy classes,
 * making validation extensible without modifying existing code.
 *
 * @see ValidationStrategyRegistry — singleton registry mapping type → strategy
 */

/** Result of a validation run */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Abstract strategy interface for param validation */
export abstract class ParamValidationStrategy {
  /** Human-readable strategy name (e.g. "ORB", "S/R Breakout") */
  abstract readonly name: string;

  /**
   * Validate a config object for this strategy type.
   * @param config — partial or full StrategyConfig fields
   * @returns ValidationResult with errors (blocking) and warnings (advisory)
   */
  abstract validate(config: Record<string, unknown>): ValidationResult;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function numVal(config: Record<string, unknown>, key: string): number | undefined {
  const v = config[key];
  return typeof v === "number" && !Number.isNaN(v) ? v : undefined;
}

function inRange(v: number, min: number, max: number): boolean {
  return v >= min && v <= max;
}

function checkRequiredRange(
  config: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  label?: string,
): string | null {
  const v = numVal(config, key);
  if (v === undefined) return `${label || key} is required`;
  if (!inRange(v, min, max)) return `${label || key} must be between ${min} and ${max}`;
  return null;
}

const SL_TP_RANGE: [number, number] = [0.1, 10];

// ---------------------------------------------------------------------------
// Concrete strategies
// ---------------------------------------------------------------------------

/** ORB strategy validation */
export class ORBValidationStrategy extends ParamValidationStrategy {
  readonly name = "ORB";

  validate(config: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const push = (err: string | null) => {
      if (err) errors.push(err);
    };

    push(checkRequiredRange(config, "or_minutes", 1, 60, "ORB window (min)"));
    push(checkRequiredRange(config, "min_or_range_pct", 0.1, 5, "Min OR range %"));
    push(checkRequiredRange(config, "max_or_range_pct", 0.1, 10, "Max OR range %"));
    push(checkRequiredRange(config, "sl_pct", SL_TP_RANGE[0], SL_TP_RANGE[1], "Stop-loss %"));
    push(checkRequiredRange(config, "tp_pct", SL_TP_RANGE[0], SL_TP_RANGE[1], "Take-profit %"));

    const minPct = numVal(config, "min_or_range_pct");
    const maxPct = numVal(config, "max_or_range_pct");
    if (minPct !== undefined && maxPct !== undefined && minPct >= maxPct) {
      errors.push("Min OR range % must be less than Max OR range %");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
}

/** S/R Breakout strategy validation */
export class SRBreakoutValidationStrategy extends ParamValidationStrategy {
  readonly name = "S/R Breakout";

  validate(config: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const pivotType = config.pivot_type;
    const VALID_PIVOTS = ["classic", "fibonacci", "camarilla"];
    if (typeof pivotType !== "string" || !VALID_PIVOTS.includes(pivotType)) {
      errors.push(`Pivot type must be one of: ${VALID_PIVOTS.join(", ")}`);
    }

    const push = (err: string | null) => {
      if (err) errors.push(err);
    };

    push(checkRequiredRange(config, "breakout_buffer_pct", 0, 1, "Breakout buffer %"));
    push(checkRequiredRange(config, "sl_pct", SL_TP_RANGE[0], SL_TP_RANGE[1], "Stop-loss %"));
    push(checkRequiredRange(config, "tp_pct", SL_TP_RANGE[0], SL_TP_RANGE[1], "Take-profit %"));

    return { valid: errors.length === 0, errors, warnings };
  }
}

/** EMA Crossover strategy validation */
export class EMACrossValidationStrategy extends ParamValidationStrategy {
  readonly name = "EMA Cross";

  validate(config: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const push = (err: string | null) => {
      if (err) errors.push(err);
    };

    push(checkRequiredRange(config, "ema_fast_period", 3, 50, "Fast EMA period"));
    push(checkRequiredRange(config, "ema_slow_period", 10, 200, "Slow EMA period"));
    push(checkRequiredRange(config, "sl_pct", SL_TP_RANGE[0], SL_TP_RANGE[1], "Stop-loss %"));
    push(checkRequiredRange(config, "tp_pct", SL_TP_RANGE[0], SL_TP_RANGE[1], "Take-profit %"));

    const fast = numVal(config, "ema_fast_period");
    const slow = numVal(config, "ema_slow_period");
    if (fast !== undefined && slow !== undefined && fast >= slow) {
      errors.push("Fast EMA period must be less than Slow EMA period");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
}

/** Swing strategy validation (shared by 52W_CHASER and 52W_TARGET) */
export class SwingValidationStrategy extends ParamValidationStrategy {
  readonly name = "52W Swing";

  validate(config: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const push = (err: string | null) => {
      if (err) errors.push(err);
    };

    push(checkRequiredRange(config, "entry_threshold_pct", 0.5, 10, "Entry threshold %"));
    push(checkRequiredRange(config, "trailing_stop_pct", 0.1, 10, "Trailing stop %"));
    push(checkRequiredRange(config, "max_holding_days", 1, 90, "Max holding days"));
    push(checkRequiredRange(config, "cooldown_days", 1, 90, "Cooldown days"));

    return { valid: errors.length === 0, errors, warnings };
  }
}

// ---------------------------------------------------------------------------
// Registry (Singleton)
// ---------------------------------------------------------------------------

/**
 * Singleton registry that maps strategy_type strings to ParamValidationStrategy instances.
 *
 * Usage:
 *   const result = ValidationStrategyRegistry.getInstance().validate("ORB", config);
 */
export class ValidationStrategyRegistry {
  private static instance: ValidationStrategyRegistry;
  private readonly strategies = new Map<string, ParamValidationStrategy>();

  private constructor() {
    // Register built-in strategies
    this.register("ORB", new ORBValidationStrategy());
    this.register("SR_BREAKOUT", new SRBreakoutValidationStrategy());
    this.register("EMA_CROSS", new EMACrossValidationStrategy());
    this.register("52W_CHASER", new SwingValidationStrategy());
    this.register("52W_TARGET", new SwingValidationStrategy());
  }

  static getInstance(): ValidationStrategyRegistry {
    if (!ValidationStrategyRegistry.instance) {
      ValidationStrategyRegistry.instance = new ValidationStrategyRegistry();
    }
    return ValidationStrategyRegistry.instance;
  }

  /** Register a strategy type with its validator */
  register(type: string, strategy: ParamValidationStrategy): void {
    this.strategies.set(type, strategy);
  }

  /** Get the validator for a strategy type. Throws if not registered. */
  get(type: string): ParamValidationStrategy {
    const strategy = this.strategies.get(type);
    if (!strategy) {
      throw new Error(`No validation strategy registered for type "${type}"`);
    }
    return strategy;
  }

  /** Convenience: validate config for a given strategy type */
  validate(type: string, config: Record<string, unknown>): ValidationResult {
    return this.get(type).validate(config);
  }
}
