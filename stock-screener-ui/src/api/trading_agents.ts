/**
 * TradingAgents API Client
 * Provides functions to interact with TradingAgents backend for stock analysis
 */

import { fetchWithAuth } from "../state/auth";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";
const TRADING_AGENTS_BASE = `${API_BASE}/api/trading-agents`;

export interface Conversation {
  id: string;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  ticker?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface AnalysisRequest {
  ticker: string;
  date?: string;
  analysts?: string[];
  debate_rounds?: number;
  llm_provider?: string;
  deep_think_model?: string;
  quick_think_model?: string;
  output_language?: string;
  use_alpha_vantage?: boolean;
  save_reports?: boolean;
}

export interface AnalysisResponse {
  ticker: string;
  date: string;
  decision: string;
  reports: Record<string, unknown>;
  stats: {
    llm_calls: number;
    tool_calls: number;
    tokens_in: number;
    tokens_out: number;
  };
  messages?: Array<{ timestamp: string; role: string; content: string }>;
  tool_calls?: Array<{ timestamp: string; tool: string; args: unknown }>;
}

export interface ConfigResponse {
  available_providers: string[];
  default_provider: string;
  available_models: Record<string, string[]>;
  default_analysts: string[];
}

export interface ChatRequest {
  message: string;
  ticker?: string;
  conversation_id?: string;
}

export interface ChatResponse {
  response: string;
  conversation_id: string;
  sources?: Array<unknown>;
  should_analyze?: string;
}

export interface StreamEvent {
  event: string;
  data: unknown;
}

export interface HealthResponse {
  status: string;
  tradingagents_available: boolean;
  timestamp: string;
}

/**
 * Get available configuration options
 */
export async function getTradingAgentsConfig(): Promise<ConfigResponse> {
  const response = await fetchWithAuth(`${TRADING_AGENTS_BASE}/config`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Failed to get config" }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Check if TradingAgents is available
 */
export async function checkTradingAgentsHealth(): Promise<HealthResponse> {
  const response = await fetchWithAuth(`${TRADING_AGENTS_BASE}/health`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Health check failed" }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Run full stock analysis (non-streaming)
 */
export async function analyzeStock(request: AnalysisRequest): Promise<AnalysisResponse> {
  const response = await fetchWithAuth(`${TRADING_AGENTS_BASE}/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Analysis failed" }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Stream stock analysis using SSE
 */
export async function* streamStockAnalysis(
  ticker: string,
  options?: {
    date?: string;
    analysts?: string[];
    llm_provider?: string;
  },
): AsyncGenerator<StreamEvent> {
  const params = new URLSearchParams();
  params.set("ticker", ticker);
  if (options?.date) params.set("date", options.date);
  if (options?.analysts) params.set("analysts", options.analysts.join(","));
  if (options?.llm_provider) params.set("llm_provider", options.llm_provider);

  const response = await fetchWithAuth(
    `${TRADING_AGENTS_BASE}/stream/${ticker}?${params.toString()}`,
    {
      headers: {
        Accept: "text/event-stream",
      },
    },
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Stream failed" }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  if (!response.body) {
    throw new Error("No response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") return;

        try {
          const parsed = JSON.parse(data);
          // Determine event type from data
          if (parsed.ticker && !parsed.stats) {
            yield { event: "connected", data: parsed };
          } else if (parsed.percent !== undefined) {
            yield { event: "progress", data: parsed };
          } else if (parsed.section) {
            yield { event: "report", data: parsed };
          } else if (parsed.error) {
            yield { event: "error", data: parsed };
          } else if (parsed.stats || parsed.decision) {
            yield { event: "complete", data: parsed };
          } else {
            yield { event: "status", data: parsed };
          }
        } catch {
          // Not JSON, skip
        }
      }
    }
  }
}

/**
 * Simple chat for quick questions
 */
export async function sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
  const response = await fetchWithAuth(`${TRADING_AGENTS_BASE}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Chat failed" }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Parse SSE event stream into readable chunks
 * Useful for implementing custom streaming in components
 */
export async function listConversations(): Promise<Conversation[]> {
  const response = await fetchWithAuth(`${TRADING_AGENTS_BASE}/conversations`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return data.conversations || [];
}

export async function createConversation(title?: string): Promise<Conversation> {
  const params = title ? `?title=${encodeURIComponent(title)}` : "";
  const response = await fetchWithAuth(`${TRADING_AGENTS_BASE}/conversations${params}`, {
    method: "POST",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function getMessages(conversationId: string): Promise<ChatMessage[]> {
  const response = await fetchWithAuth(
    `${TRADING_AGENTS_BASE}/conversations/${conversationId}/messages`,
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return data.messages || [];
}

export async function addMessage(
  conversationId: string,
  role: string,
  content: string,
  ticker?: string,
): Promise<ChatMessage> {
  const params = new URLSearchParams();
  params.set("role", role);
  params.set("content", content);
  if (ticker) params.set("ticker", ticker);
  const response = await fetchWithAuth(
    `${TRADING_AGENTS_BASE}/conversations/${conversationId}/messages?${params.toString()}`,
    { method: "POST" },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const response = await fetchWithAuth(`${TRADING_AGENTS_BASE}/conversations/${conversationId}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

export async function fetchWithSSE(
  url: string,
  onEvent: (event: string, data: unknown) => void,
  options?: RequestInit,
): Promise<void> {
  const response = await fetchWithAuth(url, {
    ...options,
    headers: {
      ...options?.headers,
      Accept: "text/event-stream",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  if (!response.body) {
    throw new Error("No response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        const event = line.slice(7);
        const dataLine = lines.shift();
        if (dataLine?.startsWith("data: ")) {
          try {
            const data = JSON.parse(dataLine.slice(6));
            onEvent(event, data);
          } catch {
            onEvent(event, dataLine.slice(6));
          }
        }
      } else if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          onEvent("message", data);
        } catch {
          onEvent("message", line.slice(6));
        }
      }
    }
  }
}
