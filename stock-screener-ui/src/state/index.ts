/**
 * State management for Stock Screener UI
 */

import type {
  ScreenerData,
  Filters,
  ScreenerOption,
  ProfileMeta,
  ChangeNotification,
  NotifFilter,
  SortDirection,
} from "../types";
import { DEFAULT_FILTERS, DEFAULT_AUTO_REFRESH_SECONDS } from "../constants";

// Data state
export let data: ScreenerData | null = null;
export let isLoading = false;
export let error: string | null = null;

// Auto-refresh state
export let autoRefreshInterval: ReturnType<typeof setInterval> | null = null;
export let autoRefreshSeconds = DEFAULT_AUTO_REFRESH_SECONDS;

// Filter state
export let filters: Filters = { ...DEFAULT_FILTERS };

// Sort state
export let sortColumn: string | null = null;
export let sortDirection: SortDirection = "desc";

// Screener state
export let screenerOptions: ScreenerOption[] = [];
export let activeScreener = "trending";
export let profileMetaById: Record<string, ProfileMeta> = {};
export let profileFilterValues: Record<string, string | number> = {};

// Notification state
export let notifications: ChangeNotification[] = [];
export let notifSeq = 1;
export let notifPanelOpen = true;
export let notifFilter: NotifFilter = "all";

// Recent additions tracking
export let recentAddedSymbols: Record<string, number> = {};

// Setters
export function setData(newData: ScreenerData | null) {
  data = newData;
}

export function setIsLoading(loading: boolean) {
  isLoading = loading;
}

export function setError(err: string | null) {
  error = err;
}

export function setAutoRefreshInterval(interval: ReturnType<typeof setInterval> | null) {
  autoRefreshInterval = interval;
}

export function setAutoRefreshSeconds(seconds: number) {
  autoRefreshSeconds = seconds;
}

export function setFilters(newFilters: Filters) {
  filters = newFilters;
}

export function updateFilter(key: keyof Filters, value: string | number) {
  if (key === "sector") {
    filters[key] = value as string;
  } else {
    filters[key] = value as number;
  }
}

export function setSortColumn(column: string | null) {
  sortColumn = column;
}

export function setSortDirection(direction: SortDirection) {
  sortDirection = direction;
}

export function setScreenerOptions(options: ScreenerOption[]) {
  screenerOptions = options;
}

export function setActiveScreener(screener: string) {
  activeScreener = screener;
}

export function setProfileMetaById(meta: Record<string, ProfileMeta>) {
  profileMetaById = meta;
}

export function setProfileFilterValues(values: Record<string, string | number>) {
  profileFilterValues = values;
}

export function updateProfileFilterValue(key: string, value: string | number) {
  profileFilterValues[key] = value;
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

export function resetFilters() {
  filters = { ...DEFAULT_FILTERS };
}
