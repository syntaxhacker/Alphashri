import { useState, useEffect } from "react";

// v2: the v1 key was written automatically with its opt-in default (`false`)
// on first mount, so every existing profile looked like a deliberate opt-out.
// The tape now defaults on; the version suffix gives profiles one clean start.
const STORAGE_KEY = "alphashri_show_market_ticker_v2";

export function useMarketTickerEnabled(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : true; // default: on (fills the header tape)
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(enabled));
  }, [enabled]);

  return [enabled, setEnabled];
}
