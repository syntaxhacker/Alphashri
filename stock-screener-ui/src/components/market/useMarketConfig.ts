/**
 * Market tab adapter for the saved-config store.
 *
 * Pure mapping only — `MarketConfigValue` <-> the flat `market.filters` v1 wire
 * payload — plus the Solid hook the panel wires to. The two silent killers this
 * file exists to prevent:
 *
 * - `JSON.stringify(new Set())` is `"{}"`: `capTiers` must be spread to an
 *   array on the way out and rebuilt through the known tiers on the way in.
 * - `search` is not persisted (it is a momentary lookup, and the panel keeps it
 *   in its own signal), so it is dropped from `serialize` and reset to `""` in
 *   `parse`.
 */

import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import {
  createSavedConfigStore,
  registerSavedConfigScope,
  type SavedConfigErrorCode,
  type SavedConfigScope,
  type SavedConfigStatus,
} from "../../state/savedConfig";
import { DEFAULT_MARKET_UNIVERSE } from "../../api/marketScreener";
import { MARKET_UNIVERSE_DESCRIPTORS } from "../../config/marketUniverses";
import type { MarketUniverse } from "../../types/marketScreener";
import { isRecord, parseStringList } from "../../utils/persistedConfig";
import { normalizeMarketView, type MarketViewMode } from "./MarketMapView";
import {
  DEFAULT_MARKET_SIZE_METRIC,
  isMarketSizeMetric,
  type MarketSizeMetric,
} from "./marketTreemap";
import {
  CAP_TIERS,
  DEFAULT_MARKET_SORT,
  MARKET_SORT_OPTIONS,
  defaultMarketFilters,
  type MarketFilterState,
  type MarketSortKey,
} from "./marketFilters";

export const MARKET_CONFIG_SCOPE = "market.filters";
export const MARKET_CONFIG_VERSION = 1;

export interface MarketConfigValue {
  universe: MarketUniverse;
  /** `search` is always `""` here — it is never restored or saved. */
  filters: MarketFilterState;
  view: MarketViewMode;
  /**
   * The map's single sizing metric, carried on the legacy `colorBy` wire field
   * so saved configs keep restoring without a migration. Colour is no longer
   * selected: tiles are always green/red by day change.
   */
  colorBy?: MarketSizeMetric;
}

/** One registry drives the dropdown, the parser and the default filters. */
const UNIVERSES: ReadonlySet<string> = new Set(
  MARKET_UNIVERSE_DESCRIPTORS.map((descriptor) => descriptor.value),
);
const SORTS: ReadonlySet<string> = new Set(MARKET_SORT_OPTIONS.map((o) => o.value));
const TIERS: ReadonlySet<string> = new Set(CAP_TIERS);

/** Server-side caps, mirrored so a hostile payload cannot ship NaN geometry. */
const NUMERIC_LIMITS: Record<string, [number, number]> = {
  priceMin: [0, 10_000_000],
  priceMax: [0, 10_000_000],
  dayChangeMin: [-100, 100],
  dayChangeMax: [-100, 100],
  mcapMinCr: [0, 100_000_000],
  mcapMaxCr: [0, 100_000_000],
  rsiMin: [0, 100],
  rsiMax: [0, 100],
  relVolMin: [0, 1000],
  relVolMax: [0, 1000],
  // Value filters. Bounds are deliberately generous: these are ratios and
  // percentages, and a legitimate distressed name can be an extreme outlier.
  peMax: [-1000, 10_000],
  psMax: [-1000, 10_000],
  pbMax: [-1000, 10_000],
  roeMin: [-1000, 1000],
  divYieldMin: [-100, 100],
  fcfYieldMin: [-100, 100],
  debtToEquityMax: [-100, 10_000],
  revYoyMin: [-1000, 10_000],
  epsYoyMin: [-10_000, 10_000],
};

/** The `number | null` members only — writing a filter is only valid for these. */
type NumericFilterKey = {
  [K in keyof MarketFilterState]: MarketFilterState[K] extends number | null ? K : never;
}[keyof MarketFilterState];
const NUMERIC_KEYS = Object.keys(NUMERIC_LIMITS) as NumericFilterKey[];

function parseNumber(raw: unknown, key: string): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const limits = NUMERIC_LIMITS[key];
  if (!limits) return raw;
  return raw < limits[0] || raw > limits[1] ? null : raw;
}

function parseCapTiers(raw: unknown): Set<string> {
  if (!Array.isArray(raw)) return new Set<string>();
  const out = new Set<string>();
  for (const item of raw) {
    if (typeof item === "string" && TIERS.has(item)) out.add(item);
  }
  return out;
}

export function defaultMarketConfig(
  overrides: Partial<Pick<MarketConfigValue, "universe" | "view" | "colorBy">> = {},
): MarketConfigValue {
  const universe = overrides.universe ?? DEFAULT_MARKET_UNIVERSE;
  return {
    universe,
    filters: defaultMarketFilters(universe),
    view: overrides.view ?? "table",
    colorBy: isMarketSizeMetric(overrides.colorBy)
      ? overrides.colorBy
      : DEFAULT_MARKET_SIZE_METRIC,
  };
}

/**
 * Wire payload -> value. `null` means "this build cannot read it" (store then
 * serves defaults + one warning). Per-field tolerance everywhere else: one
 * retired sector or a stale cap tier must not cost the other 17 filters.
 */
export function parseMarketConfig(raw: unknown): MarketConfigValue | null {
  if (!isRecord(raw)) return null;
  // The plan sketched `{universe, filters}`; the shipped v1 is flat. Accept
  // both so a payload written by either build still restores. A top-level
  // `universe` is authoritative — the nested body never gets to override it.
  const flat = isRecord(raw.filters)
    ? {
        ...raw,
        ...raw.filters,
        universe: typeof raw.universe === "string" ? raw.universe : raw.filters.universe,
      }
    : raw;

  const rawUniverse = typeof flat.universe === "string" ? flat.universe : DEFAULT_MARKET_UNIVERSE;
  if (!UNIVERSES.has(rawUniverse)) return null;
  // Resolve the universe before building filters so a future unit-specific
  // default in `defaultMarketFilters` sees the saved universe, not the baseline.
  const universe = rawUniverse as MarketUniverse;

  const filters = defaultMarketFilters(universe);
  for (const key of NUMERIC_KEYS) {
    filters[key] = parseNumber(flat[key], key);
  }
  filters.capTiers = parseCapTiers(flat.capTiers);
  filters.sectors = parseStringList(flat.sectors);
  filters.aboveSma20 = flat.aboveSma20 === true;
  filters.aboveSma50 = flat.aboveSma50 === true;
  filters.aboveSma200 = flat.aboveSma200 === true;
  filters.fnoOnly = flat.fnoOnly === true;
  filters.sort =
    typeof flat.sort === "string" && SORTS.has(flat.sort)
      ? (flat.sort as MarketSortKey)
      : DEFAULT_MARKET_SORT;
  filters.search = "";

  // A saved `map` predates the Vis rename; normalize it here rather than with
  // a stored-config migration so old payloads keep hydrating to a live view.
  const view = normalizeMarketView(flat.view);
  const colorBy = isMarketSizeMetric(flat.colorBy)
    ? flat.colorBy
    : DEFAULT_MARKET_SIZE_METRIC;

  return { universe, filters, view, colorBy };
}

/** Value -> wire payload. `search` and every non-persisted field stay out. */
export function serializeMarketConfig(value: MarketConfigValue): Record<string, unknown> {
  const f = value.filters;
  return {
    universe: value.universe,
    capTiers: [...f.capTiers],
    priceMin: f.priceMin ?? null,
    priceMax: f.priceMax ?? null,
    dayChangeMin: f.dayChangeMin ?? null,
    dayChangeMax: f.dayChangeMax ?? null,
    mcapMinCr: f.mcapMinCr ?? null,
    mcapMaxCr: f.mcapMaxCr ?? null,
    rsiMin: f.rsiMin ?? null,
    rsiMax: f.rsiMax ?? null,
    relVolMin: f.relVolMin ?? null,
    relVolMax: f.relVolMax ?? null,
    aboveSma20: f.aboveSma20,
    aboveSma50: f.aboveSma50,
    aboveSma200: f.aboveSma200,
    fnoOnly: f.fnoOnly,
    sectors: [...f.sectors],
    sort: f.sort,
    view: value.view,
    colorBy: isMarketSizeMetric(value.colorBy) ? value.colorBy : DEFAULT_MARKET_SIZE_METRIC,
  };
}

export const marketConfigScope: SavedConfigScope<MarketConfigValue> = registerSavedConfigScope({
  scope: MARKET_CONFIG_SCOPE,
  version: MARKET_CONFIG_VERSION,
  defaults: () => defaultMarketConfig(),
  parse: parseMarketConfig,
  serialize: serializeMarketConfig,
});

export interface UseMarketConfigOptions {
  /**
   * The layout the URL asked for, or `undefined` when it asked for nothing.
   * `?view=` is the only market param today; `table` is never written to the
   * URL, so a `table` prop cannot be told apart from a bare link.
   */
  urlView?: MarketViewMode;
  /** Applies a hydrated/adopted value; the panel batches this into its signals. */
  onApply: (value: MarketConfigValue) => void;
}

export interface UseMarketConfigResult {
  status: () => SavedConfigStatus;
  error: () => SavedConfigErrorCode;
  warning: () => string | null;
  hydrated: () => boolean;
  save: (value: MarketConfigValue) => void;
  retry: () => void;
  forget: () => void;
}

/**
 * Binds the store to the panel: hydrate once on mount, then mirror every change
 * into the debounce. The save effect is `defer`red — its first run is always the
 * mount echo of the defaults, and allowing it would close the latch before the
 * GET could ever apply.
 */
export function useMarketConfig(options: UseMarketConfigOptions): UseMarketConfigResult {
  const store = createSavedConfigStore(marketConfigScope);
  // The store is a plain module-style object; Solid needs a signal to observe
  // it, so every notify bumps a counter and the accessors read through it.
  const [version, setVersion] = createSignal(0);

  createEffect(() => {
    const unsubscribe = store.subscribe(() => setVersion((n) => n + 1));
    onCleanup(unsubscribe);
  });

  const read = () => {
    version();
    return store.getState();
  };

  const error = () => read().error;
  const status = () => read().status;
  const warning = () => read().warning;
  const hydrated = () => read().hydrated;

  onMount(() => {
    store.hydrate({
      override: options.urlView ? { view: options.urlView } : undefined,
      apply: options.onApply,
    });
  });

  onCleanup(() => store.dispose());

  return {
    status,
    error,
    warning,
    hydrated,
    save: (value) => store.scheduleSave(value),
    retry: () => void store.retry(),
    forget: () => void store.forget(),
  };
}
