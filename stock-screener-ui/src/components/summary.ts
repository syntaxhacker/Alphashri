/**
 * Summary strip component
 */

import type { SummaryItem } from "../types";

export function renderSummaryStrip(summary: SummaryItem[]): string {
  if (!summary || summary.length === 0) return "";

  return `
    <div class="summary-strip" data-testid="summary-strip">
      ${summary
        .map(
          (item) => `
        <div class="summary-item" data-testid="summary-item">
          <span class="summary-label" data-testid="summary-label">${item.label}</span>
          <span class="summary-value" data-testid="summary-value">${item.value}</span>
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}
