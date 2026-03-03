/**
 * Bot Management API Client
 */

import type {
  BotConfig,
  BotCreate,
  BotUpdate,
  BotStatus,
  StrategyComparison,
  AvailableStrategy,
} from "../types/bots";
import { apiGet, apiPost, apiPut, apiDelete, apiPostAction } from "./utils";

const BOT_BASE = "/api/bots";

// List all bots
export async function listBots(): Promise<BotConfig[]> {
  return apiGet<BotConfig[]>(BOT_BASE);
}

// Get a specific bot
export async function getBot(botId: number): Promise<BotConfig> {
  return apiGet<BotConfig>(`${BOT_BASE}/${botId}`);
}

// Create a new bot
export async function createBot(data: BotCreate): Promise<BotConfig> {
  return apiPost<BotConfig>(BOT_BASE, data);
}

// Update a bot
export async function updateBot(botId: number, data: BotUpdate): Promise<BotConfig> {
  return apiPut<BotConfig>(`${BOT_BASE}/${botId}`, data);
}

// Delete a bot
export async function deleteBot(botId: number): Promise<{ message: string }> {
  return apiDelete<{ message: string }>(`${BOT_BASE}/${botId}`);
}

// Start a bot
export async function startBot(
  botId: number,
  testMode: boolean = false,
): Promise<{ message: string; pid: number; log_file: string }> {
  const params = testMode ? { test_mode: "true" } : undefined;
  return apiPostAction<{ message: string; pid: number; log_file: string }>(
    `${BOT_BASE}/${botId}/start`,
    params,
  );
}

// Stop a bot
export async function stopBot(botId: number): Promise<{ message: string }> {
  return apiPostAction<{ message: string }>(`${BOT_BASE}/${botId}/stop`);
}

// Get bot status
export async function getBotStatus(botId: number): Promise<BotStatus> {
  return apiGet<BotStatus>(`${BOT_BASE}/${botId}/status`);
}

// Get bot logs
export async function getBotLogs(
  botId: number,
  lines: number = 100,
): Promise<{ logs: string; total_lines: number; showing: number }> {
  return apiGet<{ logs: string; total_lines: number; showing: number }>(
    `${BOT_BASE}/${botId}/logs`,
    { lines },
  );
}

// Get bot portfolio
export async function getBotPortfolio(botId: number): Promise<{
  bot_id: number;
  portfolio: any;
  positions: any[];
  strategies: Record<string, any>;
  timestamp: string;
}> {
  return apiGet<{
    bot_id: number;
    portfolio: any;
    positions: any[];
    strategies: Record<string, any>;
    timestamp: string;
  }>(`${BOT_BASE}/${botId}/portfolio`);
}

// Get bot positions
export async function getBotPositions(
  botId: number,
  strategyId?: number,
): Promise<{ bot_id: number; positions: any[]; count: number }> {
  const params = strategyId ? { strategy_id: strategyId } : undefined;
  return apiGet<{ bot_id: number; positions: any[]; count: number }>(
    `${BOT_BASE}/${botId}/positions`,
    params,
  );
}

// Get bot performance
export async function getBotPerformance(botId: number, days: number = 30): Promise<any> {
  return apiGet<any>(`${BOT_BASE}/${botId}/performance`, { days });
}

// Compare strategy performance
export async function compareStrategyPerformance(
  botId: number,
): Promise<{ bot_id: number; comparison: StrategyComparison[]; timestamp: string }> {
  return apiGet<{ bot_id: number; comparison: StrategyComparison[]; timestamp: string }>(
    `${BOT_BASE}/${botId}/performance/compare`,
  );
}

// List available strategies
export async function listAvailableStrategies(): Promise<AvailableStrategy[]> {
  return apiGet<AvailableStrategy[]>(`${BOT_BASE}/available-strategies`);
}
