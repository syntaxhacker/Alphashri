/**
 * Symbol Search Component
 *
 * Reusable autocomplete component for searching and selecting stock symbols.
 * Features:
 * - Debounced search (300ms)
 * - Keyboard navigation (↑↓ Enter Escape)
 * - Click to select
 * - Customizable placeholder and callbacks
 */

import { searchSymbols, SymbolResult } from "../../api/symbols";

// State for each search instance
interface SearchState {
  query: string;
  results: SymbolResult[];
  isOpen: boolean;
  selectedIndex: number;
  isLoading: boolean;
  debounceTimer: number | null;
  selectedSymbols: string[]; // Symbols to exclude from results
}

// Store state per instance by container ID
const searchStates = new Map<string, SearchState>();

function getSearchState(containerId: string): SearchState {
  if (!searchStates.has(containerId)) {
    searchStates.set(containerId, {
      query: "",
      results: [],
      isOpen: false,
      selectedIndex: 0,
      isLoading: false,
      debounceTimer: null,
      selectedSymbols: [],
    });
  }
  return searchStates.get(containerId)!;
}

export interface SymbolSearchOptions {
  containerId: string;
  placeholder?: string;
  inputClass?: string;
  onSelect: (symbol: string) => void;
  onFocus?: () => void;
  minChars?: number; // Minimum characters before searching (default: 1)
}

/**
 * Render the symbol search input and attach event handlers.
 * Returns HTML string for the input element.
 */
export function renderSymbolSearch(options: SymbolSearchOptions): string {
  const {
    containerId,
    placeholder = "Search symbol...",
    inputClass = "symbol-search-input",
  } = options;

  return `
    <div class="symbol-search-wrapper" id="${containerId}">
      <input
        type="text"
        class="${inputClass}"
        placeholder="${placeholder}"
        autocomplete="off"
        data-search-container="${containerId}"
        onfocus="window.handleSymbolSearchFocus('${containerId}')"
        onblur="window.handleSymbolSearchBlur('${containerId}')"
        oninput="window.handleSymbolSearchInput('${containerId}', this.value)"
        onkeydown="window.handleSymbolSearchKeydown('${containerId}', event)"
      />
      <div class="symbol-search-dropdown" id="${containerId}-dropdown"></div>
    </div>
  `;
}

/**
 * Initialize global handlers for symbol search.
 * Call this once when the app loads.
 */
export function initSymbolSearchHandlers(): void {
  (window as any).handleSymbolSearchFocus = (containerId: string) => {
    const state = getSearchState(containerId);
    state.isOpen = true;
    if (state.results.length > 0) {
      renderDropdown(containerId);
    }
  };

  (window as any).handleSymbolSearchBlur = (containerId: string) => {
    // Delay to allow click on dropdown items
    setTimeout(() => {
      const state = getSearchState(containerId);
      state.isOpen = false;
      hideDropdown(containerId);
    }, 200);
  };

  (window as any).handleSymbolSearchInput = (containerId: string, value: string) => {
    const state = getSearchState(containerId);
    state.query = value;
    state.selectedIndex = 0;

    // Clear previous timer
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
    }

    const minChars = 1;

    if (value.trim().length < minChars) {
      state.results = [];
      hideDropdown(containerId);
      return;
    }

    // Debounced search
    state.debounceTimer = window.setTimeout(async () => {
      state.isLoading = true;
      renderDropdown(containerId); // Show loading state

      let results = await searchSymbols(value, 10);
      // Filter out already selected symbols
      results = results.filter((r) => !state.selectedSymbols.includes(r.symbol));
      state.results = results;
      state.isLoading = false;
      state.selectedIndex = 0;

      if (state.isOpen && results.length > 0) {
        renderDropdown(containerId);
      } else {
        hideDropdown(containerId);
      }
    }, 300);
  };

  (window as any).handleSymbolSearchKeydown = (containerId: string, event: KeyboardEvent) => {
    const state = getSearchState(containerId);

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (state.results.length > 0) {
          state.selectedIndex = Math.min(state.selectedIndex + 1, state.results.length - 1);
          renderDropdown(containerId);
        }
        break;

      case "ArrowUp":
        event.preventDefault();
        if (state.results.length > 0) {
          state.selectedIndex = Math.max(state.selectedIndex - 1, 0);
          renderDropdown(containerId);
        }
        break;

      case "Enter":
        event.preventDefault();
        if (state.results.length > 0 && state.selectedIndex >= 0) {
          selectSymbol(containerId, state.results[state.selectedIndex].symbol);
        }
        break;

      case "Escape":
        state.isOpen = false;
        hideDropdown(containerId);
        break;
    }
  };

  (window as any).selectSymbolFromSearch = (containerId: string, symbol: string) => {
    selectSymbol(containerId, symbol);
  };
}

function selectSymbol(containerId: string, symbol: string): void {
  const state = getSearchState(containerId);

  // Find the options for this container
  const input = document.querySelector(
    `[data-search-container="${containerId}"]`,
  ) as HTMLInputElement;
  if (input) {
    input.value = ""; // Clear input
  }

  // Reset state
  state.query = "";
  state.results = [];
  state.isOpen = false;
  state.selectedIndex = 0;
  hideDropdown(containerId);

  // Get callback from data attribute or global
  const callbackKey = `symbolSearchCallback_${containerId}`;
  const callback = (window as any)[callbackKey];
  if (callback) {
    callback(symbol);
  }
}

function renderDropdown(containerId: string): void {
  const state = getSearchState(containerId);
  const dropdown = document.getElementById(`${containerId}-dropdown`);
  if (!dropdown) return;

  if (state.isLoading) {
    dropdown.innerHTML = '<div class="symbol-search-loading">Searching...</div>';
    dropdown.classList.add("visible");
    return;
  }

  if (state.results.length === 0) {
    dropdown.classList.remove("visible");
    return;
  }

  dropdown.innerHTML = state.results
    .map(
      (result, index) => `
    <div
      class="symbol-search-item ${index === state.selectedIndex ? "selected" : ""}"
      onmousedown="window.selectSymbolFromSearch('${containerId}', '${result.symbol}')"
    >
      <span class="symbol-search-symbol">${result.symbol}</span>
      <span class="symbol-search-name">${result.name}</span>
    </div>
  `,
    )
    .join("");

  dropdown.classList.add("visible");
}

function hideDropdown(containerId: string): void {
  const dropdown = document.getElementById(`${containerId}-dropdown`);
  if (dropdown) {
    dropdown.classList.remove("visible");
  }
}

/**
 * Update the list of already selected symbols to exclude from search results.
 */
export function setSelectedSymbols(containerId: string, symbols: string[]): void {
  const state = getSearchState(containerId);
  state.selectedSymbols = symbols;
}

/**
 * Register a callback for when a symbol is selected.
 */
export function registerSymbolSearchCallback(
  containerId: string,
  callback: (symbol: string) => void,
): void {
  (window as any)[`symbolSearchCallback_${containerId}`] = callback;
}
