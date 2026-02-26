/**
 * TradingList component for copy-paste functionality
 */

import type { Stock } from "../types";
import { getTradingList } from "../runtime_utils";

export function renderTradingListBlock(id: string, stocks: Stock[]): string {
  const list = getTradingList(stocks);
  return `
    <div class="tradinglist-wrap" data-testid="tradinglist-wrap">
      <div class="tradinglist-head">
        <span data-testid="tradinglist-label">TradingList View (copy)</span>
        <button data-testid="tradinglist-copy-btn" onclick="window.copyTradingList('${id}')">Copy</button>
      </div>
      <textarea id="${id}" data-testid="tradinglist-textarea" class="tradinglist-box" readonly>${list}</textarea>
    </div>
  `;
}
