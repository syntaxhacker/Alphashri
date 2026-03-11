import { apiGet, apiPostAction, API_BASE } from "./utils";

export interface BrokerStatus {
  connected: boolean;
  broker: string;
  expires_in_hours: number | null;
  expires_at: string | null;
}

export async function getBrokerStatus(): Promise<BrokerStatus> {
  return apiGet<BrokerStatus>("/api/brokers/status");
}

export async function connectUpstox(): Promise<void> {
  window.open(`${API_BASE}/api/brokers/upstox/auth`, "_blank");
}

export async function disconnectUpstox(): Promise<void> {
  await apiPostAction<void>("/api/brokers/upstox/disconnect");
}
