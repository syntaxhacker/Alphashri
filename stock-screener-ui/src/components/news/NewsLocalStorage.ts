const LS_READ_IDS = "news_read_ids";
const LS_LAST_SEEN_ID = "news_last_seen_id";
const LS_AUTO_REFRESH = "news_auto_refresh";

export const AUTO_REFRESH_INTERVALS = [
  { label: "Off", value: "0" },
  { label: "1m", value: "60000" },
  { label: "5m", value: "300000" },
  { label: "10m", value: "600000" },
];

export function getReadIds(): Set<string> {
  try {
    const stored = localStorage.getItem(LS_READ_IDS);
    if (stored) return new Set(JSON.parse(stored));
  } catch {
    // ignore
  }
  return new Set();
}

export function saveReadIds(ids: Set<string>): void {
  try {
    localStorage.setItem(LS_READ_IDS, JSON.stringify(Array.from(ids).slice(-500)));
  } catch {
    // ignore
  }
}

export function getStoredLastSeenId(): string | null {
  try {
    return localStorage.getItem(LS_LAST_SEEN_ID);
  } catch {
    return null;
  }
}

export function saveLastSeenId(id: string): void {
  try {
    localStorage.setItem(LS_LAST_SEEN_ID, id);
  } catch {
    // ignore
  }
}

export function getStoredAutoRefresh(): string {
  try {
    return localStorage.getItem(LS_AUTO_REFRESH) || "0";
  } catch {
    return "0";
  }
}

export function saveAutoRefresh(ms: string): void {
  try {
    localStorage.setItem(LS_AUTO_REFRESH, ms);
  } catch {
    // ignore
  }
}
