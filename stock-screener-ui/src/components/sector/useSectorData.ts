import { useState, useCallback } from "react";
import type { SectorResponse, SectorAlert, InternalStockMover } from "./sectorUtils";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

interface UseSectorDataReturn {
  market: "india" | "america";
  setMarket: (m: "india" | "america") => void;
  activeTab: string | null;
  setActiveTab: (t: string | null) => void;
  data: SectorResponse | null;
  loading: boolean;
  error: string | null;
  loadData: (market: string) => Promise<void>;
  alerts: SectorAlert[];
  intervalMovers: InternalStockMover[];
}

export function useSectorData(): UseSectorDataReturn {
  const [market, setMarket] = useState<"india" | "america">("india");
  const [activeTab, setActiveTab] = useState<string | null>("dashboard");
  const [data, setData] = useState<SectorResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<SectorAlert[]>([]);
  const [intervalMovers, setIntervalMovers] = useState<InternalStockMover[]>([]);

  const loadData = useCallback(async (m: string) => {
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
      setError(err.message || "Failed to fetch sector data");
    } finally {
      setLoading(false);
    }
  }, []);

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
