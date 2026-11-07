/**
 * Correlation API Client
 */

import { fetchWithAuth } from "../state/auth";
import { jsonOrThrow } from "./utils/request";

import { API_ENDPOINTS } from "./config";

export interface CorrelationRequest {
  symbols: string[];
  timeframe: "daily" | "intraday";
  period: number;
  period_unit: "days" | "minutes";
}

export interface CorrelationDataPoint {
  timestamp: string;
  value: number;
}

export interface CorrelationMeta {
  start_date: string;
  end_date: string;
  data_points: number;
}

export interface CorrelationResponse {
  matrix: number[][];
  symbols: string[];
  normalized: Record<string, CorrelationDataPoint[]>;
  meta: CorrelationMeta;
}

export async function fetchCorrelation(params: CorrelationRequest): Promise<CorrelationResponse> {
  const response = await fetchWithAuth(API_ENDPOINTS.CORRELATION, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return jsonOrThrow<CorrelationResponse>(response, "Failed to fetch correlation data");
}
