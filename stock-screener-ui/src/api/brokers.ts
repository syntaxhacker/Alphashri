import { apiGet, apiPostAction, API_BASE } from "./utils";

export interface BrokerStatus {
  connected: boolean;
  broker: string;
  expires_in_hours: number | null;
  expires_at: string | null;
}

export async function getBrokerStatus(broker: string = "upstox"): Promise<BrokerStatus> {
  return apiGet<BrokerStatus>(`/api/brokers/status?broker=${encodeURIComponent(broker)}`);
}

export async function connectUpstox(): Promise<void> {
  window.open(`${API_BASE}/api/brokers/upstox/auth`, "_blank");
}

export async function disconnectUpstox(): Promise<void> {
  await apiPostAction<void>("/api/brokers/upstox/disconnect");
}

export async function connectFyers(): Promise<void> {
  window.open(`${API_BASE}/api/brokers/fyers/auth`, "_blank");
}

export async function disconnectFyers(): Promise<void> {
  await apiPostAction<void>("/api/brokers/fyers/disconnect");
}
