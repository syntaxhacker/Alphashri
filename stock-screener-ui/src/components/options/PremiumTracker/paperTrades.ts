export interface PaperTrade {
  id: string;
  date: string;
  underlying: "NIFTY" | "BANKNIFTY";
  side: "CE" | "PE";
  strike: number;
  qty: number;
  entry: number;
  exit: number | null;
  note: string;
}

const STORAGE_KEY = "premium-paper-trades";

function uid(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export function loadPaperTrades(): PaperTrade[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePaperTrades(trades: PaperTrade[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
}

export function newPaperTrade(input: Omit<PaperTrade, "id" | "exit">): PaperTrade {
  return { ...input, id: uid(), exit: null };
}

export function tradePnl(trade: PaperTrade): number | null {
  if (trade.exit === null || trade.exit === undefined) return null;
  return (trade.exit - trade.entry) * trade.qty;
}

export function tradePnlPct(trade: PaperTrade): number | null {
  if (trade.exit === null || trade.exit === undefined || !trade.entry) return null;
  return ((trade.exit - trade.entry) / trade.entry) * 100;
}
