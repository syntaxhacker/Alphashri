export type Conviction = "LOW" | "MEDIUM" | "HIGH";

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
  conviction: Conviction;
  plan: string;
  review: string;
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
    if (!Array.isArray(parsed)) return [];
    // Backward compat: diary entries saved before conviction/plan/review existed.
    return parsed.map((t) => ({
      conviction: "MEDIUM" as Conviction,
      plan: "",
      review: "",
      ...t,
    }));
  } catch {
    return [];
  }
}

export function savePaperTrades(trades: PaperTrade[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
}

export function newPaperTrade(
  input: Omit<PaperTrade, "id" | "exit" | "conviction" | "plan" | "review"> &
    Partial<Pick<PaperTrade, "conviction" | "plan" | "review">>,
): PaperTrade {
  return {
    conviction: "MEDIUM",
    plan: "",
    review: "",
    ...input,
    id: uid(),
    exit: null,
  };
}

export function updateTrade(
  trades: PaperTrade[],
  id: string,
  patch: Partial<Omit<PaperTrade, "id">>,
): PaperTrade[] {
  return trades.map((t) => (t.id === id ? { ...t, ...patch } : t));
}

export function tradePnl(trade: PaperTrade): number | null {
  if (trade.exit === null || trade.exit === undefined) return null;
  return (trade.exit - trade.entry) * trade.qty;
}

export function tradePnlPct(trade: PaperTrade): number | null {
  if (trade.exit === null || trade.exit === undefined || !trade.entry) return null;
  return ((trade.exit - trade.entry) / trade.entry) * 100;
}

function lessonKey(date: string): string {
  return `premium-lesson-${date}`;
}

export function loadLesson(date: string): string {
  try {
    const raw = localStorage.getItem(lessonKey(date));
    if (!raw) return "";
    return JSON.parse(raw);
  } catch {
    return "";
  }
}

export function saveLesson(date: string, text: string): void {
  localStorage.setItem(lessonKey(date), JSON.stringify(text));
}

export function uniqueDays(trades: PaperTrade[]): string[] {
  return [...new Set(trades.map((t) => t.date))].sort().reverse();
}

export interface DaySummary {
  day: string;
  trades: number;
  wins: number;
  total: number;
}

export function summarizeDay(trades: PaperTrade[], day: string): DaySummary {
  const dayTrades = trades.filter((t) => t.date === day);
  const closed = dayTrades.filter((t) => t.exit !== null && t.exit !== undefined);
  const wins = closed.filter((t) => (tradePnl(t) ?? 0) > 0).length;
  const total = closed.reduce((sum, t) => sum + (tradePnl(t) ?? 0), 0);
  return { day, trades: dayTrades.length, wins, total };
}
