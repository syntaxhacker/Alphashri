import { createSubscriber } from "./createSubscriber";
import type {
  ScreenerData,
  ScreenerOption,
  ProfileMeta,
  ChangeNotification,
  NotifFilter,
  SortDirection,
} from "../types";
import { DEFAULT_AUTO_REFRESH_SECONDS } from "../config/constants";

export const DEFAULT_SCREENER_DATA: ScreenerData = {
  approaching: [],
  touched: [],
  last_updated: "",
  provider: "upstox",
  mode: "intraday",
  screener: "trending",
};

const { subscribe, notify: notifySubscribers } = createSubscriber();
export { subscribe, notifySubscribers };

const { subscribe: subscribeToSelection, notify: notifySelectionSubscribers } = createSubscriber();
export { subscribeToSelection };

export let data: ScreenerData = { ...DEFAULT_SCREENER_DATA };
export let isLoading = false;
export let error: string | null = null;

export let autoRefreshInterval: ReturnType<typeof setInterval> | null = null;
export let autoRefreshSeconds = DEFAULT_AUTO_REFRESH_SECONDS;

export let sortColumn: string | null = null;
export let sortDirection: SortDirection = "desc";

export let screenerOptions: ScreenerOption[] = [];
export let activeScreener = "52w_high";
export let profileMetaById: Record<string, ProfileMeta> = {};
export let profileFilters: Record<string, number | string> = {};

export let notifications: ChangeNotification[] = [];
export let notifSeq = 1;
export let notifPanelOpen = true;
export let notifFilter: NotifFilter = "all";

export let recentAddedSymbols: Record<string, number> = {};

export function setData(newData: ScreenerData) {
  data = newData;
  notifySubscribers();
}

export function setIsLoading(loading: boolean) {
  isLoading = loading;
  notifySubscribers();
}

export function setError(err: string | null) {
  error = err;
  notifySubscribers();
}

export function setAutoRefreshInterval(interval: ReturnType<typeof setInterval> | null) {
  autoRefreshInterval = interval;
}

export function setAutoRefreshSeconds(seconds: number) {
  autoRefreshSeconds = seconds;
  notifySubscribers();
}

export function setSortColumn(column: string | null) {
  sortColumn = column;
  notifySubscribers();
}

export function setSortDirection(direction: SortDirection) {
  sortDirection = direction;
  notifySubscribers();
}

export function setScreenerOptions(options: ScreenerOption[]) {
  screenerOptions = options;
  notifySubscribers();
}

export function setActiveScreener(screener: string) {
  activeScreener = screener;
  notifySubscribers();
}

export function setActiveProvider(provider: string) {
  data = { ...data, provider };
  notifySubscribers();
}

export function setActiveMode(mode: string) {
  data = { ...data, mode };
  notifySubscribers();
}

export function setProfileMetaById(meta: Record<string, ProfileMeta>) {
  profileMetaById = meta;
}

export function setProfileFilters(filters: Record<string, number | string>) {
  profileFilters = filters;
  notifySubscribers();
}

export function addNotification(notification: ChangeNotification) {
  notifications.push(notification);
}

export function setNotifications(newNotifications: ChangeNotification[]) {
  notifications = newNotifications;
}

export function clearNotifications() {
  notifications = [];
  notifSeq = 1;
}

export function incrementNotifSeq() {
  notifSeq++;
}

export function setNotifPanelOpen(open: boolean) {
  notifPanelOpen = open;
}

export function setNotifFilter(filter: NotifFilter) {
  notifFilter = filter;
}

export function setRecentAddedSymbols(symbols: Record<string, number>) {
  recentAddedSymbols = symbols;
}

export let selectedSymbols: string[] = [];

export function toggleSymbolSelection(symbol: string) {
  const idx = selectedSymbols.indexOf(symbol);
  if (idx >= 0) {
    selectedSymbols = [...selectedSymbols.slice(0, idx), ...selectedSymbols.slice(idx + 1)];
  } else {
    selectedSymbols = [...selectedSymbols, symbol];
  }
  notifySelectionSubscribers();
}

export function setSelectedSymbols(symbols: string[]) {
  selectedSymbols = symbols;
  notifySelectionSubscribers();
}

export function clearSelectedSymbols() {
  selectedSymbols = [];
  notifySelectionSubscribers();
}
