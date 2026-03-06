import { createRoot, Root } from 'react-dom/client';
import React from 'react';
import { ScreenerPage } from '../components/screener';
import type { ScreenerPageProps, Stock, Filters, ScreenerOption, SummaryItem, ProfileFilterDef } from '../components/screener/types';
import * as state from '../state';

let root: Root | null = null;
let container: HTMLElement | null = null;

export interface BridgeProps {
  stocks: Stock[];
  touchedSymbols: string[];
  filters: Filters;
  sectors: string[];
  profileFilters?: ProfileFilterDef[];
  profileFilterValues: Record<string, any>;
  screenerOptions: ScreenerOption[];
  activeScreener: string;
  title: string;
  status: string;
  isLoading: boolean;
  autoRefreshSeconds: number;
  provider: string;
  mode: string;
  summary?: SummaryItem[];
  error?: string | null;
}

export function mountScreenerPage(rootContainer: HTMLElement, props: BridgeProps) {
  container = rootContainer;
  if (!root) {
    root = createRoot(rootContainer);
  }

  const touchedSymbolsSet = new Set(props.touchedSymbols);

  const pageProps: ScreenerPageProps = {
    screenerOptions: props.screenerOptions || state.screenerOptions,
    activeScreener: props.activeScreener || state.activeScreener,
    onScreenerChange: (id) => {
      if ((window as any).changeScreener) {
        (window as any).changeScreener(id);
      }
    },

    title: props.title,
    status: props.status,
    isLoading: props.isLoading,
    autoRefreshSeconds: props.autoRefreshSeconds || state.autoRefreshSeconds,
    provider: props.provider,
    mode: props.mode,
    onRefresh: () => {
      if ((window as any).refresh) {
        (window as any).refresh();
      }
    },
    onAutoRefreshChange: (value) => {
      if ((window as any).setAutoRefresh) {
        (window as any).setAutoRefresh(value);
      }
    },
    onProviderChange: (value) => {
      if ((window as any).changeProvider) {
        (window as any).changeProvider(value);
      }
    },
    onModeChange: (value) => {
      if ((window as any).changeMode) {
        (window as any).changeMode(value);
      }
    },

    filters: props.filters || state.filters,
    sectors: props.sectors || [],
    profileFilters: props.profileFilters,
    onFilterChange: (key, value) => {
      if ((window as any).updateFilter) {
        (window as any).updateFilter(key, value);
      }
    },
    onResetFilters: () => {
      if ((window as any).resetFilters) {
        (window as any).resetFilters();
      }
    },

    stocks: props.stocks,
    touchedSymbols: touchedSymbolsSet,
    summary: props.summary,

    onSymbolClick: (symbol) => {
      if ((window as any).onSymbolClick) {
        (window as any).onSymbolClick(symbol);
      }
    },
    onSymbolHover: (symbol) => {
      if ((window as any).onSymbolHover) {
        (window as any).onSymbolHover(symbol);
      }
    },

    error: props.error || state.error,
  };

  root.render(React.createElement(ScreenerPage, pageProps));
}

export function unmountScreenerPage() {
  if (root) {
    root.unmount();
    root = null;
  }
  container = null;
}

export function updateScreenerPage(props: Partial<BridgeProps>) {
  if (!container) {
    console.error('Screener page not mounted. Call mountScreenerPage first.');
    return;
  }
  mountScreenerPage(container, props as BridgeProps);
}

(window as any).mountScreenerPage = mountScreenerPage;
(window as any).unmountScreenerPage = unmountScreenerPage;
(window as any).updateScreenerPage = updateScreenerPage;
