export interface LLMRun {
  id: number;
  url: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  response_time_ms: number;
  status: string;
  created_at: string;
}

export interface ModelUsage {
  model: string;
  count: number;
}

export interface Aggregate {
  total_runs: number;
  total_tokens: number;
  total_cost_usd: number;
  avg_response_time_ms: number;
  models_used: ModelUsage[];
}

export interface LLMStats {
  recent_runs: LLMRun[];
  aggregate: Aggregate;
  error?: string;
}
