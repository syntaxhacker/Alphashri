import { useState, useEffect } from "react";

const STORAGE_KEY = "alphashri_show_market_ticker";

export function useMarketTickerEnabled(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : false; // default: false (opt-in)
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(enabled));
  }, [enabled]);

  return [enabled, setEnabled];
}
