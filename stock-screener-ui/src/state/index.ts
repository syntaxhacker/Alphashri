/**
 * State management for Alphashri
 */

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

// Data state - initialize with empty structure to avoid null checks
export let data: ScreenerData = { ...DEFAULT_SCREENER_DATA };
export let isLoading = false;
export let error: string | null = null;

// Auto-refresh state
export let autoRefreshInterval: ReturnType<typeof setInterval> | null = null;
export let autoRefreshSeconds = DEFAULT_AUTO_REFRESH_SECONDS;

// Sort state
export let sortColumn: string | null = null;
export let sortDirection: SortDirection = "desc";

// Screener state
export let screenerOptions: ScreenerOption[] = [];
export let activeScreener = "trending";
export let profileMetaById: Record<string, ProfileMeta> = {};

// Notification state
export let notifications: ChangeNotification[] = [];
export let notifSeq = 1;
export let notifPanelOpen = true;
export let notifFilter: NotifFilter = "all";

// Recent additions tracking
export let recentAddedSymbols: Record<string, number> = {};

// Setters
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

export function setProfileMetaById(meta: Record<string, ProfileMeta>) {
  profileMetaById = meta;
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
