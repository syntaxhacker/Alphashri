/**
 * StoreRegistry — formal Singleton that provides a single global access point
 * for all application state stores.
 *
 * Intent (GoF): Ensure a class has only one instance and provide a global
 * point of access to it.
 *
 * Why a singleton? The module-level exported state variables in state/*.ts
 * (e.g. `export let data`, `export let isLoading`) already behave as
 * singletons — they are instantiated once when the module is first imported.
 * StoreRegistry formalises this into one global registry so that stores can
 * be looked up by name rather than importing each module individually.
 *
 * Usage:
 *   import { StoreRegistry } from "../patterns/singleton/StoreRegistry";
 *   const reg = StoreRegistry.getInstance();
 *   reg.register("screener", { data, isLoading, ... });
 *   const screener = reg.get<ScreenerStore>("screener");
 */

import type { ScreenerData, SortDirection } from "../../types";
import type { PaperTradingState } from "../../types/paperTrading";
import type { StrategiesState } from "../../types/strategies";
import type { BotsState } from "../../types/bots";

// ---------------------------------------------------------------------------
// Exported interfaces
// ---------------------------------------------------------------------------

/** Shape of the screener store, mirroring the exports in state/index.ts */
export interface ScreenerStore {
  data: ScreenerData;
  isLoading: boolean;
  error: string | null;
  sortColumn: string | null;
  sortDirection: SortDirection;
  activeScreener: string;
  selectedSymbols: string[];

  // Setters
  setData(data: ScreenerData): void;
  setIsLoading(loading: boolean): void;
  setError(err: string | null): void;
  setSortColumn(column: string | null): void;
  setSortDirection(direction: SortDirection): void;
  setActiveScreener(screener: string): void;
  setSelectedSymbols(symbols: string[]): void;
  toggleSymbolSelection(symbol: string): void;
  clearSelectedSymbols(): void;
}

/** Shape of the auth store, mirroring state/auth.ts */
export interface AuthStore {
  isAuthenticated: boolean;
  user: { id: number; email: string; display_name: string | null; initial_capital: number; created_at: string } | null;
  loading: boolean;
  error: string | null;

  login(email: string, password: string): Promise<{ success: boolean; error?: string }>;
  logout(): Promise<void>;
  register(email: string, password: string, displayName?: string): Promise<{ success: boolean; error?: string }>;
  checkAuth(): Promise<boolean>;
}

/** Known store names used across the application */
export type StoreName = "screener" | "auth" | "paperTrading" | "strategies" | "bots";

/** Typed mapping from StoreName to the corresponding store interface */
export type StoreMap = {
  screener: ScreenerStore;
  auth: AuthStore;
  paperTrading: PaperTradingState;
  strategies: StrategiesState;
  bots: BotsState;
};

// ---------------------------------------------------------------------------
// Singleton implementation
// ---------------------------------------------------------------------------

export class StoreRegistry {
  /** The single class-level instance */
  private static instance: StoreRegistry;

  /** Internal map of store name → store instance */
  private readonly stores: Map<string, unknown> = new Map();

  /**
   * Private constructor — enforce singleton via getInstance().
   */
  private constructor() {
    // Intentionally empty.
  }

  /**
   * Returns the one-and-only StoreRegistry instance, creating it lazily.
   */
  public static getInstance(): StoreRegistry {
    if (!StoreRegistry.instance) {
      StoreRegistry.instance = new StoreRegistry();
    }
    return StoreRegistry.instance;
  }

  /**
   * Register a store under a given name.
   * If a store with the same name already exists a warning is emitted to the
   * console. The caller is responsible for passing the correct store shape.
   */
  public register<T>(name: string, store: T): void {
    if (this.stores.has(name)) {
      console.warn(`[StoreRegistry] Overwriting existing store: "${name}"`);
    }
    this.stores.set(name, store);
  }

  /**
   * Retrieve a previously registered store.
   * @throws If no store is registered under the given name.
   */
  public get<T>(name: string): T {
    const store = this.stores.get(name);
    if (store === undefined) {
      throw new Error(
        `[StoreRegistry] Store "${name}" not found. Ensure it is registered before calling get().`,
      );
    }
    return store as T;
  }

  /**
   * Check whether a store is registered under the given name.
   */
  public has(name: string): boolean {
    return this.stores.has(name);
  }

  /**
   * Return a plain object snapshot of all registered stores (for debugging /
   * devtools inspection).
   */
  public getAll(): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {};
    for (const [key, value] of this.stores.entries()) {
      snapshot[key] = value;
    }
    return snapshot;
  }

  // -----------------------------------------------------------------------
  // Test support
  // -----------------------------------------------------------------------

  /**
   * Reset the singleton instance and clear all registered stores.
   * Intended for test isolation — call in beforeEach / afterEach.
   */
  public static reset(): void {
    if (StoreRegistry.instance) {
      StoreRegistry.instance.stores.clear();
    }
    StoreRegistry.instance = undefined as unknown as StoreRegistry;
  }
}
