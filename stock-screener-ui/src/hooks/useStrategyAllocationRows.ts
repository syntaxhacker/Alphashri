import { useState, useEffect } from "react";
import type { StrategyWithAllocation } from "../types/bots";

export interface StrategyAllocationRow {
  id: string;
  strategy_id: string;
  capital_allocation_pct: number;
  max_positions: number;
}

export function useStrategyAllocationRows(
  bot: { strategies: StrategyWithAllocation[] } | null,
  opened: boolean,
) {
  const [strategies, setStrategies] = useState<StrategyAllocationRow[]>([]);
  const [nextId, setNextId] = useState(1);

  useEffect(() => {
    if (opened && bot) {
      setStrategies(
        bot.strategies.map((s, i) => ({
          id: `existing-${i}`,
          strategy_id: s.id,
          capital_allocation_pct: s.capital_allocation_pct * 100,
          max_positions: s.max_positions,
        })),
      );
    } else if (opened) {
      setStrategies([]);
    }
    setNextId(100);
  }, [opened, bot]);

  const handleAddStrategy = () => {
    setStrategies([
      ...strategies,
      {
        id: `new-${nextId}`,
        strategy_id: "",
        capital_allocation_pct: 20,
        max_positions: 3,
      },
    ]);
    setNextId(nextId + 1);
  };

  const handleRemoveStrategy = (id: string) => {
    setStrategies(strategies.filter((s) => s.id !== id));
  };

  const handleUpdateStrategy = (
    id: string,
    field: keyof StrategyAllocationRow,
    value: string | number,
  ) => {
    setStrategies(strategies.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  return {
    strategies,
    handleAddStrategy,
    handleRemoveStrategy,
    handleUpdateStrategy,
  };
}
