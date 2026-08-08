/**
 * Preview Chart Manager
 *
 * Manages hover preview charts and expanded inline charts for symbols.
 * - Hover: Shows mini chart (today only, 15min TF)
 * - Click: Expands larger panel with controls
 */

import { fetchChartPreview, ChartPreviewData } from "../../api/chartPreview";
import { buildChartOption, ChartSize } from "../chart/chartRenderer";
import { ERROR_COLOR } from "../../config/colors";

// Preview state
interface PreviewState {
  mode: "hidden" | "hover" | "expanded";
  symbol: string | null;
  timeframe: number;
  orMinutes: number;
  days: number;
  data: ChartPreviewData | null;
  isLoading: boolean;
}

const state: PreviewState = {
  mode: "hidden",
  symbol: null,
  timeframe: 15,
  orMinutes: 45,
  days: 1,
  data: null,
  isLoading: false,
};

let hoverTimer: number | null = null;
let hoverContainer: HTMLElement | null = null;
let expandedContainer: HTMLElement | null = null;
let chartInstance: EChartsInstance | null = null;

const HOVER_DELAY = 300; // ms before showing preview
const HOVER_CONTAINER_ID = "chart-hover-popup";
const EXPANDED_CONTAINER_ID = "chart-expanded-panel";

/**
 * Show preview chart on hover.
 * Debounced by HOVER_DELAY ms.
 */
export function showPreviewChart(event: MouseEvent, symbol: string): void {
  // Clear any existing timer
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }

  // Debounce: show after delay
  hoverTimer = window.setTimeout(() => {
    if (state.mode === "expanded") {
      return; // Don't show hover if expanded
    }

    state.symbol = symbol;
    state.mode = "hover";
    state.days = 1; // Hover shows today only
    state.timeframe = 15;

    renderHoverChart(event, symbol);
  }, HOVER_DELAY);
}

/**
 * Hide preview chart when mouse leaves.
 */
export function hidePreviewChart(): void {
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }

  if (state.mode === "hover") {
    state.mode = "hidden";
    removeHoverChart();
  }
}

/**
 * Toggle expanded chart on click.
 */
export function toggleExpandedChart(symbol: string): void {
  // Clear hover timer
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }

  // Remove hover if visible
  removeHoverChart();

  if (state.mode === "expanded" && state.symbol === symbol) {
    // Collapse if clicking same symbol
    collapseChart();
  } else {
    // Expand this symbol
    state.symbol = symbol;
    state.mode = "expanded";
    state.days = 5; // Expanded shows 5 days
    state.timeframe = 15;

    renderExpandedChart(symbol);
  }
}

/**
 * Collapse expanded chart.
 */
export function collapseChart(): void {
  state.mode = "hidden";
  state.symbol = null;
  state.data = null;
  removeExpandedChart();
}

/**
 * Navigate to full chart page.
 */
export function navigateToFullChart(symbol: string): void {
  // Collapse expanded panel first
  collapseChart();

  // Use history API for BrowserRouter navigation
  window.history.pushState({}, "", `/chart/${symbol}`);
  // Dispatch popstate to trigger React Router to update
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * Update timeframe for expanded chart.
 */
export function setPreviewTimeframe(tf: number): void {
  if (state.timeframe === tf) return;

  state.timeframe = tf;
  if (state.mode === "expanded" && state.symbol) {
    fetchAndRenderChart(state.symbol, "expanded");
  }
}

/**
 * Update OR minutes for expanded chart.
 */
export function setPreviewOrMinutes(orMinutes: number): void {
  if (state.orMinutes === orMinutes) return;

  state.orMinutes = orMinutes;
  if (state.mode === "expanded" && state.symbol) {
    fetchAndRenderChart(state.symbol, "expanded");
  }
}

// ============================================
// Internal rendering functions
// ============================================

async function renderHoverChart(event: MouseEvent, symbol: string): Promise<void> {
  // Create container if needed
  if (!hoverContainer) {
    hoverContainer = document.createElement("div");
    hoverContainer.id = HOVER_CONTAINER_ID;
    hoverContainer.className = "chart-hover-popup";
    hoverContainer.setAttribute("data-testid", "preview-chart-hover");
    document.body.appendChild(hoverContainer);
  }

  // Position near cursor
  const x = event.clientX + 15;
  const y = event.clientY + 15;

  // Adjust if near edge of screen
  const maxX = window.innerWidth - 340;
  const maxY = window.innerHeight - 220;

  hoverContainer.style.left = `${Math.min(x, maxX)}px`;
  hoverContainer.style.top = `${Math.min(y, maxY)}px`;

  // Show loading state
  hoverContainer.innerHTML = `
    <div class="chart-title">${symbol} <span class="tf-badge">15m</span></div>
    <div class="chart-body-loading">Loading...</div>
  `;
  hoverContainer.style.display = "block";

  // Fetch and render
  await fetchAndRenderChart(symbol, "preview");
}

async function renderExpandedChart(symbol: string): Promise<void> {
  // Create container if needed
  if (!expandedContainer) {
    expandedContainer = document.createElement("div");
    expandedContainer.id = EXPANDED_CONTAINER_ID;
    expandedContainer.className = "chart-expanded-panel";
    expandedContainer.setAttribute("data-testid", "preview-chart-expanded");
    document.body.appendChild(expandedContainer);
  }

  // Show expanded panel with loading state
  expandedContainer.innerHTML = `
    <div class="panel-header">
      <span class="symbol-name">${symbol}</span>
      <select class="tf-select" onchange="window.setPreviewTimeframe(parseInt(this.value))">
        <option value="1" ${state.timeframe === 1 ? "selected" : ""}>1m</option>
        <option value="5" ${state.timeframe === 5 ? "selected" : ""}>5m</option>
        <option value="15" ${state.timeframe === 15 ? "selected" : ""}>15m</option>
        <option value="30" ${state.timeframe === 30 ? "selected" : ""}>30m</option>
        <option value="60" ${state.timeframe === 60 ? "selected" : ""}>1h</option>
      </select>
      <select class="or-select" onchange="window.setPreviewOrMinutes(parseInt(this.value))">
        <option value="30" ${state.orMinutes === 30 ? "selected" : ""}>OR 30m</option>
        <option value="45" ${state.orMinutes === 45 ? "selected" : ""}>OR 45m</option>
        <option value="60" ${state.orMinutes === 60 ? "selected" : ""}>OR 60m</option>
      </select>
      <button class="close-btn" onclick="window.collapseChart()">×</button>
    </div>
    <div class="chart-body">
      <div class="chart-body-loading">Loading chart...</div>
    </div>
    <div class="panel-footer">
      <a href="#/chart/${symbol}" onclick="window.navigateToFullChart('${symbol}')">Open Full Chart →</a>
    </div>
  `;
  expandedContainer.style.display = "block";

  // Add backdrop click to close
  expandedContainer.onclick = (e) => {
    if (e.target === expandedContainer) {
      collapseChart();
    }
  };

  // Fetch and render
  await fetchAndRenderChart(symbol, "expanded");
}

async function fetchAndRenderChart(symbol: string, size: ChartSize): Promise<void> {
  state.isLoading = true;

  try {
    const data = await fetchChartPreview(symbol, state.timeframe, state.days, state.orMinutes);

    if (!data || data.candles.length === 0) {
      showError(size, "No data available");
      return;
    }

    state.data = data;

    // Build chart option
    const chartOption = buildChartOption({
      symbol: data.symbol,
      candles: data.candles,
      orb_zones: data.orb_zones,
      pivot_levels: data.pivot_levels,
      high_52w: data.high_52w ?? null,
      show52wHigh: size !== "preview" && !!data.high_52w,
      size,
      showPivots: size !== "preview",
    });

    if (!chartOption) {
      showError(size, "Failed to build chart");
      return;
    }

    // Render to appropriate container
    const container = size === "preview" ? hoverContainer : expandedContainer;
    if (!container) return;

    // Get or create ECharts container
    let chartBody = container.querySelector(".chart-body") as HTMLElement;
    if (!chartBody) {
      chartBody = container.querySelector(".chart-body-loading")?.parentElement as HTMLElement;
      if (chartBody) {
        chartBody.innerHTML = `<div class="chart-body" style="height: ${size === "preview" ? "160" : "350"}px;"></div>`;
        chartBody = chartBody.querySelector(".chart-body") as HTMLElement;
      }
    }

    if (!chartBody) return;

    // Ensure chart body has proper size
    chartBody.style.height = size === "preview" ? "160px" : "350px";
    chartBody.innerHTML = ""; // Clear loading

    // Create ECharts container
    const chartDiv = document.createElement("div");
    chartDiv.style.width = "100%";
    chartDiv.style.height = "100%";
    chartDiv.id = `preview-echarts-${symbol}-${Date.now()}`;
    chartBody.appendChild(chartDiv);

    // Initialize ECharts
    if (!window.echarts) {
      showError(size, "ECharts not loaded");
      return;
    }

    // Dispose previous instance
    if (chartInstance) {
      chartInstance.dispose();
    }

    chartInstance = window.echarts.init(chartDiv);
    chartInstance.setOption(chartOption);

    // Update title if expanded
    if (size === "expanded") {
      const titleEl = container.querySelector(".symbol-name");
      if (titleEl) {
        titleEl.textContent = `${symbol} (${data.candles.length} candles)`;
      }
    }
  } catch (error) {
    console.error("Error fetching chart preview:", error);
    showError(size, "Error loading chart");
  } finally {
    state.isLoading = false;
  }
}

function showError(size: ChartSize, message: string): void {
  const container = size === "preview" ? hoverContainer : expandedContainer;
  if (!container) return;

  const bodyEl = container.querySelector(".chart-body-loading");
  if (bodyEl) {
    bodyEl.textContent = message;
    bodyEl.style.color = ERROR_COLOR;
  }
}

function removeHoverChart(): void {
  if (hoverContainer) {
    hoverContainer.style.display = "none";
    hoverContainer.innerHTML = "";
  }
  if (chartInstance && state.mode === "hover") {
    chartInstance.dispose();
    chartInstance = null;
  }
}

function removeExpandedChart(): void {
  if (expandedContainer) {
    expandedContainer.style.display = "none";
    expandedContainer.innerHTML = "";
  }
  if (chartInstance) {
    chartInstance.dispose();
    chartInstance = null;
  }
}

// ============================================
// Initialize window handlers
// ============================================

export function initPreviewChartHandlers(): void {
  window.showPreviewChart = showPreviewChart;
  window.hidePreviewChart = hidePreviewChart;
  window.toggleExpandedChart = toggleExpandedChart;
  window.collapseChart = collapseChart;
  window.navigateToFullChart = navigateToFullChart;
  window.setPreviewTimeframe = setPreviewTimeframe;
  window.setPreviewOrMinutes = setPreviewOrMinutes;
}
