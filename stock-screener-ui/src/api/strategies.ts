/**
 * Strategy Management API Client
 */

import type {
  StrategyConfig,
  StrategyCreate,
  StrategyUpdate,
  StrategyPerformance,
  BotConfig,
} from "../types/strategies";

const API_BASE = "http://localhost:8765";

// List all strategies
export async function listStrategies(
  includeTemplates: boolean = false,
  strategyType?: string,
): Promise<{ strategies: StrategyConfig[]; count: number }> {
  const params = new URLSearchParams();
  if (includeTemplates) params.set("include_templates", "true");
  if (strategyType) params.set("strategy_type", strategyType);

  const url = `${API_BASE}/api/strategies${params.toString() ? `?${params}` : ""}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to list strategies: ${response.statusText}`);
  }
  return response.json();
}

// List strategy templates
export async function listTemplates(): Promise<{
  templates: StrategyConfig[];
  count: number;
}> {
  const response = await fetch(`${API_BASE}/api/strategies/templates`);
  if (!response.ok) {
    throw new Error(`Failed to list templates: ${response.statusText}`);
  }
  return response.json();
}

// Get a specific strategy
export async function getStrategy(
  strategyId: number,
): Promise<{ strategy: StrategyConfig; variations: StrategyConfig[] }> {
  const response = await fetch(`${API_BASE}/api/strategies/${strategyId}`);
  if (!response.ok) {
    throw new Error(`Failed to get strategy: ${response.statusText}`);
  }
  return response.json();
}

// Create a new strategy variation
export async function createStrategy(
  data: StrategyCreate,
): Promise<{ status: string; message: string; strategy: StrategyConfig }> {
  const response = await fetch(`${API_BASE}/api/strategies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to create strategy");
  }
  return response.json();
}

// Update a strategy
export async function updateStrategy(
  strategyId: number,
  data: StrategyUpdate,
): Promise<{ status: string; message: string; strategy: StrategyConfig }> {
  const response = await fetch(`${API_BASE}/api/strategies/${strategyId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to update strategy");
  }
  return response.json();
}

// Delete a strategy (soft delete)
export async function deleteStrategy(
  strategyId: number,
): Promise<{ status: string; message: string }> {
  const response = await fetch(`${API_BASE}/api/strategies/${strategyId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to delete strategy");
  }
  return response.json();
}

// Get strategy performance
export async function getStrategyPerformance(strategyId: number): Promise<StrategyPerformance> {
  const response = await fetch(`${API_BASE}/api/strategies/${strategyId}/performance`);
  if (!response.ok) {
    throw new Error(`Failed to get strategy performance: ${response.statusText}`);
  }
  return response.json();
}

// Get trades for a specific strategy
export async function getStrategyTrades(
  strategyId: number,
  limit: number = 50,
): Promise<{ strategy_id: number; strategy_name: string; trades: any[]; total: number }> {
  const response = await fetch(`${API_BASE}/api/strategies/${strategyId}/trades?limit=${limit}`);
  if (!response.ok) {
    throw new Error(`Failed to get strategy trades: ${response.statusText}`);
  }
  return response.json();
}

// Get variations of a template
export async function getStrategyVariations(
  strategyId: number,
): Promise<{ parent: StrategyConfig; variations: StrategyConfig[]; count: number }> {
  const response = await fetch(`${API_BASE}/api/strategies/${strategyId}/variations`);
  if (!response.ok) {
    throw new Error(`Failed to get strategy variations: ${response.statusText}`);
  }
  return response.json();
}

// Bot endpoints
export async function listBots(): Promise<{
  bots: BotConfig[];
  count: number;
}> {
  const response = await fetch(`${API_BASE}/api/strategies/bots`);
  if (!response.ok) {
    throw new Error(`Failed to list bots: ${response.statusText}`);
  }
  return response.json();
}

export async function getBot(botId: number): Promise<{ bot: BotConfig }> {
  const response = await fetch(`${API_BASE}/api/strategies/bots/${botId}`);
  if (!response.ok) {
    throw new Error(`Failed to get bot: ${response.statusText}`);
  }
  return response.json();
}
