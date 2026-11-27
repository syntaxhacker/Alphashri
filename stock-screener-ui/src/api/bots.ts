import type {
  BotConfig,
  BotCreate,
  BotUpdate,
  BotStatus,
  StrategyComparison,
  AvailableStrategy,
  BotTrade,
} from "../types/bots";
import { apiGet, apiPost, apiPut, apiDelete, apiPostAction } from "./utils";

const BOT_BASE = "/api/bots";

export async function listBots(): Promise<BotConfig[]> {
  return apiGet<BotConfig[]>(BOT_BASE);
}

export async function getBot(botId: string): Promise<BotConfig> {
  return apiGet<BotConfig>(`${BOT_BASE}/${botId}`);
}

export async function createBot(data: BotCreate): Promise<BotConfig> {
  return apiPost<BotConfig>(BOT_BASE, data);
}

export async function updateBot(botId: string, data: BotUpdate): Promise<BotConfig> {
  return apiPut<BotConfig>(`${BOT_BASE}/${botId}`, data);
}

export async function deleteBot(botId: string): Promise<{ message: string }> {
  return apiDelete<{ message: string }>(`${BOT_BASE}/${botId}`);
}

export async function startBot(
  botId: string,
  testMode: boolean = false,
): Promise<{ message: string; pid: number; log_file: string }> {
  const params = testMode ? { test_mode: "true" } : undefined;
  return apiPostAction<{ message: string; pid: number; log_file: string }>(
    `${BOT_BASE}/${botId}/start`,
    params,
  );
}

export async function stopBot(botId: string): Promise<{ message: string }> {
  return apiPostAction<{ message: string }>(`${BOT_BASE}/${botId}/stop`);
}

export async function stopAllBots(): Promise<{ message: string; stopped: { id: string; name: string }[] }> {
  return apiPostAction<{ message: string; stopped: { id: string; name: string }[] }>(`${BOT_BASE}/stop-all`);
}

export async function startAllBots(): Promise<{ message: string; started: { id: string; name: string }[] }> {
  return apiPostAction<{ message: string; started: { id: string; name: string }[] }>(`${BOT_BASE}/start-all`);
}

export async function getBotStatus(botId: string): Promise<BotStatus> {
  const raw = await apiGet<BotStatus & { status_unknown?: boolean }>(`${BOT_BASE}/${botId}/status`);
  return {
    ...raw,
    status: raw.status_unknown ? "unknown" : raw.running ? "running" : "stopped",
  };
}

export async function getBotLogs(
  botId: string,
  lines: number = 100,
): Promise<{ logs: string; total_lines: number; showing: number }> {
  return apiGet<{ logs: string; total_lines: number; showing: number }>(
    `${BOT_BASE}/${botId}/logs`,
    { lines },
  );
}

export async function getBotPortfolio(botId: string): Promise<{
  bot_id: string;
  portfolio: any;
  positions: any[];
  strategies: Record<string, any>;
  timestamp: string;
}> {
  return apiGet<{
    bot_id: string;
    portfolio: any;
    positions: any[];
    strategies: Record<string, any>;
    timestamp: string;
  }>(`${BOT_BASE}/${botId}/portfolio`);
}

export async function getBotPositions(
  botId: string,
  strategyId?: string,
): Promise<{ bot_id: string; positions: any[]; count: number }> {
  const params = strategyId ? { strategy_id: strategyId } : undefined;
  return apiGet<{ bot_id: string; positions: any[]; count: number }>(
    `${BOT_BASE}/${botId}/positions`,
    params,
  );
}

export async function getBotPerformance(botId: string, days: number = 30): Promise<any> {
  return apiGet<any>(`${BOT_BASE}/${botId}/performance`, { days });
}

export async function compareStrategyPerformance(
  botId: string,
): Promise<{ bot_id: string; comparison: StrategyComparison[]; timestamp: string }> {
  return apiGet<{ bot_id: string; comparison: StrategyComparison[]; timestamp: string }>(
    `${BOT_BASE}/${botId}/performance/compare`,
  );
}

export async function listAvailableStrategies(): Promise<AvailableStrategy[]> {
  return apiGet<AvailableStrategy[]>(`${BOT_BASE}/available-strategies`);
}

// Get trade count for a bot (used to prevent deletion if trades exist)
export async function getBotTradeCount(botId: string): Promise<{ count: number }> {
  return apiGet<{ count: number }>(`${BOT_BASE}/${botId}/trade-count`);
}

export async function getBotTrades(
  botId: string,
  strategyId?: string,
  limit: number = 50,
): Promise<{ bot_id: string; trades: BotTrade[]; count: number }> {
  const params: Record<string, string | number> = { limit };
  if (strategyId !== undefined) {
    params.strategy_id = strategyId;
  }
  return apiGet<{ bot_id: string; trades: BotTrade[]; count: number }>(
    `${BOT_BASE}/${botId}/trades`,
    params,
  );
}
