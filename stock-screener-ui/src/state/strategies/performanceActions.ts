import type { StrategyPerformance } from "../../types/strategies";
import * as api from "../../api/strategies";
import {
  state,
  notify,
  setLoading,
  setError,
  loadStrategies,
} from "../strategies";

export async function loadPerformance(strategyId: number): Promise<void> {
  try {
    const perf = await api.getStrategyPerformance(strategyId);
    state.performance = perf;
    notify();
  } catch (error) {
    console.error("Failed to load performance:", error);
  }
}

export async function loadAllPerformance(): Promise<void> {
  setLoading(true);
  setError(null);

  if (state.strategies.length === 0) {
    await loadStrategies(true);
  }

  const performanceResults: StrategyPerformance[] = [];

  for (const strategy of state.strategies) {
    if (!strategy.is_template) {
      const strategyId = strategy.internal_id ?? Number(strategy.id);
      try {
        const perf = await api.getStrategyPerformance(strategyId);
        performanceResults.push(perf);
      } catch {
        performanceResults.push({
          strategy_id: strategyId,
          strategy_name: strategy.name,
          total_trades: 0,
          winners: 0,
          losers: 0,
          win_rate: 0,
          total_pnl: 0,
          net_pnl: 0,
        });
      }
    }
  }

  state.allPerformance = performanceResults;
  state.isLoading = false;
  notify();

  const pendingSelection = (window as any).__pendingStrategySelection;
  if (pendingSelection && performanceResults.length > 0) {
    delete (window as any).__pendingStrategySelection;
    const strategy = performanceResults.find((s) => s.strategy_name === pendingSelection);
    if (strategy) {
      const { selectStrategyByName } = require("../../components/strategies/performance");
      selectStrategyByName(pendingSelection, performanceResults);
    }
  }
}
