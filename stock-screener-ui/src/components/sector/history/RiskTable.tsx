import { createMemo, onMount } from "solid-js";
import { TanStackTable } from "../../common/TanStackTable";
import type { SectorHistoryRisk, SectorHistorySeries } from "../../../types/sectorHistory";
import { columns, type RiskRow } from "./RiskTable.columns";

const RISK_SCROLL_LABEL = "Sector history risk metrics, scroll sideways for all columns";

/**
 * Only the sticky column and scroll chrome live here. Row height and cell
 * padding come from the table's `dense` metrics: the 18px sparkline plus 1px
 * vertical padding on each side and the 1px row border settles every row at a
 * 21px pitch. There is no per-table `!important` height/padding override to
 * drift away from the shared rhythm.
 */
const RISK_STICKY_STYLE = `
  [data-testid="sector-history-risk-table"] th:first-child,
  [data-testid="sector-history-risk-table"] td:first-child {
    position: sticky !important;
    left: 0 !important;
    z-index: 2;
    background-color: var(--color-fin-surface) !important;
    box-shadow: 1px 0 0 var(--color-fin-border);
  }
  [data-testid="sector-history-risk-table"] th:first-child {
    z-index: 3 !important;
    background-color: var(--color-fin-surface-alt) !important;
  }
`;

export function RiskTable(props: { risk: SectorHistoryRisk[]; series: SectorHistorySeries[] }) {
  let host: HTMLDivElement | undefined;

  const rows = createMemo<RiskRow[]>(() => {
    const risk = Array.isArray(props.risk) ? props.risk : [];
    const series = Array.isArray(props.series) ? props.series : [];
    const sparks = new Map(series.map((item) => [item.name, item.monthly_returns]));
    return risk.map((item) => ({ ...item, spark: sparks.get(item.name) ?? [] }));
  });

  onMount(() => {
    const scrollEl = host?.querySelector<HTMLElement>(".paper-tanstack-scroll");
    if (!scrollEl) return;
    scrollEl.setAttribute("role", "region");
    scrollEl.setAttribute("tabIndex", "0");
    scrollEl.setAttribute("aria-label", RISK_SCROLL_LABEL);
  });

  return (
    <div
      ref={(node) => {
        host = node;
      }}
      class="min-w-0"
    >
      <style data-testid="sector-history-risk-sticky-style">{RISK_STICKY_STYLE}</style>
      <TanStackTable<RiskRow>
        data={rows()}
        columns={columns}
        dataTestId="sector-history-risk-table"
        ariaLabel={RISK_SCROLL_LABEL}
        emptyMessage="No risk metrics"
        dense
        stickyHeader
        rowWindowSize={40}
        minTableWidth={640}
        getRowTestId={(row) => `sector-history-risk-row-${row.name}`}
      />
    </div>
  );
}
