import { createSignal, type Accessor } from "solid-js";
import type { SectorResponse, SectorAlert, InternalStockMover } from "./sectorUtils";

import { API_BASE } from "@/api/config";

interface UseSectorDataReturn {
  market: Accessor<"india" | "america">;
  setMarket: (m: "india" | "america") => void;
  activeTab: Accessor<string | null>;
  setActiveTab: (t: string | null) => void;
  data: Accessor<SectorResponse | null>;
  loading: Accessor<boolean>;
  error: Accessor<string | null>;
  loadData: (market: string) => Promise<void>;
  alerts: Accessor<SectorAlert[]>;
  intervalMovers: Accessor<InternalStockMover[]>;
}

export function useSectorData(): UseSectorDataReturn {
  const [market, setMarket] = createSignal<"india" | "america">("india");
  const [activeTab, setActiveTab] = createSignal<string | null>("dashboard");
  const [data, setData] = createSignal<SectorResponse | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [alerts, setAlerts] = createSignal<SectorAlert[]>([]);
  const [intervalMovers, setIntervalMovers] = createSignal<InternalStockMover[]>([]);

  const loadData = async (m: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/sector/data?market=${m}`);
      if (!res.ok) throw new Error("Failed to fetch sector data");
      const json = await res.json();
      setData(json.data);
      setAlerts(json.alerts || []);
      setIntervalMovers(json.interval_movers || []);
    } catch (err: any) {
      setError(err?.message || "Failed to fetch sector data");
    } finally {
      setLoading(false);
    }
  };

  return {
    market,
    setMarket,
    activeTab,
    setActiveTab,
    data,
    loading,
    error,
    loadData,
    alerts,
    intervalMovers,
  };
}
