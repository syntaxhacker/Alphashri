import { useState, useEffect, useCallback, useRef } from "react";
import { fetchSectorPerformance } from "../../api/sector";
import type { SectorResponse, SectorItem, StockMover } from "../../types/sector";
import { detectSectorAlerts, detectIntervalMovers } from "./sectorUtils";
import type { SectorAlert, InternalStockMover } from "./sectorUtils";

function processSectorResponse(
  response: SectorResponse,
  prevSectorData: Record<string, number>,
  prevStockData: Record<string, number>,
  setAlerts: React.Dispatch<React.SetStateAction<SectorAlert[]>>,
  setIntervalMovers: React.Dispatch<React.SetStateAction<InternalStockMover[]>>,
) {
  const sectors = response.sectors ?? [];
  const newAlerts = detectSectorAlerts(sectors, prevSectorData);
  sectors.forEach((item: SectorItem) => {
    prevSectorData[item.sector] = item.avg_change;
  });
  if (newAlerts.length > 0) {
    setAlerts((prev) => [...newAlerts, ...prev].slice(0, 10));
  }
  const stockMovers = response.top_stock_movers ?? [];
  const newIntervalMovers = detectIntervalMovers(stockMovers, prevStockData);
  stockMovers.forEach((item: StockMover) => {
    prevStockData[item.symbol] = item.change;
  });
  if (newIntervalMovers.length > 0) {
    setIntervalMovers(newIntervalMovers.slice(0, 10));
  }
}

export function useSectorData() {
  const [data, setData] = useState<SectorResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [market, setMarket] = useState<"india" | "america">("india");
  const [activeTab, setActiveTab] = useState<string | null>("dashboard");
  const [alerts, setAlerts] = useState<SectorAlert[]>([]);
  const [intervalMovers, setIntervalMovers] = useState<InternalStockMover[]>([]);
  const prevSectorDataRef = useRef<Record<string, number>>({});
  const prevStockDataRef = useRef<Record<string, number>>({});
  const liveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = useCallback(async (mkt: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSectorPerformance(mkt);
      processSectorResponse(res, prevSectorDataRef.current, prevStockDataRef.current, setAlerts, setIntervalMovers);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sector data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    prevSectorDataRef.current = {};
    prevStockDataRef.current = {};
    setAlerts([]);
    setIntervalMovers([]);
    loadData(market);
    if (liveTimeoutRef.current) clearTimeout(liveTimeoutRef.current);
    let liveCount = 0;
    const fast = setInterval(() => {
      liveCount++;
      loadData(market);
      if (liveCount >= 5) {
        clearInterval(fast);
        liveTimeoutRef.current = null;
      }
    }, 1000);
    const slow = setInterval(() => loadData(market), 60000);
    return () => {
      clearInterval(fast);
      clearInterval(slow);
      if (liveTimeoutRef.current) clearTimeout(liveTimeoutRef.current);
    };
  }, [market, loadData]);

  return { data, loading, error, market, setMarket, activeTab, setActiveTab, alerts, intervalMovers, loadData };
}
