/**
 * Market Ticker Component
 * Displays live market data at the top of the screen
 */
import * as state from "../state/marketTicker";

export function renderMarketTicker(): string {
  const data = state.getMarketTicker();
  const loading = state.isMarketTickerLoading();

  if (loading) {
    return `
      <div class="market-ticker loading" id="market-ticker" data-testid="market-ticker">
        <div class="ticker-container">
          <span class="ticker-loading">Loading market data...</span>
        </div>
      </div>
    `;
  }

  if (!data || data.error) {
    const errorMsg = data?.error || "Market data unavailable";
    return `
      <div class="market-ticker error" id="market-ticker" data-testid="market-ticker">
        <div class="ticker-container">
          <span class="ticker-error">${errorMsg}</span>
        </div>
      </div>
    `;
  }

  const tickers = data.tickers || {};
  const lastUpdated = data.last_updated ? new Date(data.last_updated).toLocaleTimeString() : "--";

  const priorityOrder = ["^NSEI", "^NSEBANK", "GC=F", "SI=F", "CL=F", "USDINR=X"];
  const sortedSymbols = Object.keys(tickers).sort((a, b) => {
    const aPriority = priorityOrder.indexOf(a);
    const bPriority = priorityOrder.indexOf(b);
    return aPriority - bPriority;
  });

  const tickerItemsHtml = sortedSymbols
    .map((symbol) => {
      const item = tickers[symbol];
      const label = getTickerLabel(symbol);
      const price = Number(item.price ?? 0);
      const change = Number(item.change ?? 0);
      const changePercent = Number(item.change_percent ?? 0);
      const isPositive = change >= 0;

      return `
        <div class="ticker-item" data-symbol="${symbol}" data-testid="ticker-item-${symbol.replace(/[^a-zA-Z]/g, "_")}">
          <span class="ticker-label" data-testid="ticker-label">${label}</span>
          <span class="ticker-value" data-testid="ticker-value">${price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span class="ticker-change ${isPositive ? "positive" : "negative"}" data-testid="ticker-change">
            ${isPositive ? "+" : ""}${change.toFixed(2)}
            <span class="ticker-change-pct">(${changePercent.toFixed(2)}%)</span>
          </span>
        </div>
      `;
    })
    .join("");

  return `
    <div class="market-ticker" id="market-ticker" data-testid="market-ticker">
      <div class="ticker-container" data-testid="ticker-container">
        ${tickerItemsHtml}
      </div>
      <div class="ticker-footer">
        <span class="ticker-updated" data-testid="ticker-updated">Updated: ${lastUpdated}</span>
      </div>
    </div>
  `;
}

function getTickerLabel(symbol: string): string {
  switch (symbol) {
    case "^NSEBANK":
      return "Bank Nifty";
    case "^NSEI":
      return "Nifty 50";
    case "GC=F":
      return "Gold";
    case "SI=F":
      return "Silver";
    case "CL=F":
      return "Crude Oil";
    case "USDINR=X":
      return "USD/INR";
    default:
      return symbol;
  }
}
