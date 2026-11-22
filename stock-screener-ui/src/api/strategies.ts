import type {
  StrategyConfig,
  StrategyCreate,
  StrategyUpdate,
  StrategyPerformance,
  BotConfig,
} from "../types/strategies";
import { apiGet, apiPost, apiPut, apiDelete } from "./utils";

const STRATEGY_BASE = "/api/strategies";

export async function listStrategies(
  includeTemplates: boolean = false,
  strategyType?: string,
): Promise<{ strategies: StrategyConfig[]; count: number }> {
  const params: Record<string, string> = {};
  if (includeTemplates) params.include_templates = "true";
  if (strategyType) params.strategy_type = strategyType;
  return apiGet<{ strategies: StrategyConfig[]; count: number }>(STRATEGY_BASE, params);
}

export async function listTemplates(): Promise<{
  templates: StrategyConfig[];
  count: number;
}> {
  return apiGet<{ templates: StrategyConfig[]; count: number }>(`${STRATEGY_BASE}/templates`);
}

export async function getStrategy(
  strategyId: number,
): Promise<{ strategy: StrategyConfig; variations: StrategyConfig[] }> {
  return apiGet<{ strategy: StrategyConfig; variations: StrategyConfig[] }>(
    `${STRATEGY_BASE}/${strategyId}`,
  );
}

export async function createStrategy(
  data: StrategyCreate,
): Promise<{ status: string; message: string; strategy: StrategyConfig }> {
  return apiPost<{ status: string; message: string; strategy: StrategyConfig }>(
    STRATEGY_BASE,
    data,
  );
}

export async function updateStrategy(
  strategyId: number,
  data: StrategyUpdate,
): Promise<{ status: string; message: string; strategy: StrategyConfig }> {
  return apiPut<{ status: string; message: string; strategy: StrategyConfig }>(
    `${STRATEGY_BASE}/${strategyId}`,
    data,
  );
}

export async function syncVariations(
  strategyId: number,
): Promise<{ status: string; message: string; count: number }> {
  return apiPost<{ status: string; message: string; count: number }>(
    `${STRATEGY_BASE}/${strategyId}/sync-variations`,
    {},
  );
}

export async function deleteStrategy(
  strategyId: number,
): Promise<{ status: string; message: string }> {
  return apiDelete<{ status: string; message: string }>(`${STRATEGY_BASE}/${strategyId}`);
}

export async function getStrategyPerformance(strategyId: number): Promise<StrategyPerformance> {
  return apiGet<StrategyPerformance>(`${STRATEGY_BASE}/${strategyId}/performance`);
}

export async function getStrategyTrades(
  strategyId: number,
  limit: number = 50,
): Promise<{ strategy_id: number; strategy_name: string; trades: any[]; total: number }> {
  return apiGet<{ strategy_id: number; strategy_name: string; trades: any[]; total: number }>(
    `${STRATEGY_BASE}/${strategyId}/trades`,
    { limit },
  );
}

export async function getStrategyVariations(
  strategyId: number,
): Promise<{ parent: StrategyConfig; variations: StrategyConfig[]; count: number }> {
  return apiGet<{ parent: StrategyConfig; variations: StrategyConfig[]; count: number }>(
    `${STRATEGY_BASE}/${strategyId}/variations`,
  );
}

export async function listBots(): Promise<{
  bots: BotConfig[];
  count: number;
}> {
  return apiGet<{ bots: BotConfig[]; count: number }>(`${STRATEGY_BASE}/bots`);
}

export async function getBot(botId: string): Promise<{ bot: BotConfig }> {
  return apiGet<{ bot: BotConfig }>(`${STRATEGY_BASE}/bots/${botId}`);
}
