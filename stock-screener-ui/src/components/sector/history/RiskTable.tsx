import { createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Text } from "@/ui";
import { TanStackTable, type TableColumnDef } from "../../common/TanStackTable";
import { formatPercentage } from "../../../utils/ui-helpers";
import type { SectorHistoryRisk, SectorHistorySeries } from "../../../types/sectorHistory";
import { MiniSparkline } from "./visuals/MiniSparkline";

interface RiskRow extends SectorHistoryRisk {
  spark: (number | null)[];
}

const DASH = "—";
const RISK_SCROLL_LABEL = "Sector history risk metrics, scroll sideways for all columns";

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
    z-index: 3;
    background-color: var(--color-fin-surface-alt) !important;
  }
  [data-testid="sector-history-risk-table"] th,
  [data-testid="sector-history-risk-table"] td {
    height: 20px !important;
    padding-top: 1px !important;
    padding-bottom: 1px !important;
  }
  [data-testid="sector-history-risk-table"] tbody td > p {
    margin: 0 !important;
    line-height: 1.2 !important;
  }
  [data-testid="sector-history-risk-table"] tbody td > div {
    height: 18px !important;
    max-height: 18px !important;
    overflow: hidden !important;
  }
`;

function cumulativeReturn(values: (number | null)[]): number | null {
  let factor = 1;
  let seen = false;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    factor *= 1 + Math.max(-100, value) / 100;
    seen = true;
  }
  return seen ? (factor - 1) * 100 : null;
}

export function RiskTable(props: { risk: SectorHistoryRisk[]; series: SectorHistorySeries[] }) {
  let host: HTMLDivElement | undefined;
  let scrollEl: HTMLElement | undefined;
  const [overflowing, setOverflowing] = createSignal(false);
  const [atEnd, setAtEnd] = createSignal(false);

  const rows = createMemo<RiskRow[]>(() => {
    const risk = Array.isArray(props.risk) ? props.risk : [];
    const series = Array.isArray(props.series) ? props.series : [];
    const sparks = new Map(series.map((item) => [item.name, item.monthly_returns]));
    return risk.map((item) => ({ ...item, spark: sparks.get(item.name) ?? [] }));
  });

  const measure = () => {
    if (!scrollEl) return;
    const max = scrollEl.scrollWidth - scrollEl.clientWidth;
    setOverflowing(max > 2);
    setAtEnd(max <= 2 || scrollEl.scrollLeft >= max - 2);
  };

  const handleScroll = () => {
    if (!scrollEl) return;
    const max = scrollEl.scrollWidth - scrollEl.clientWidth;
    setAtEnd(max <= 2 || scrollEl.scrollLeft >= max - 2);
  };

  onMount(() => {
    scrollEl = host?.querySelector<HTMLElement>(".paper-tanstack-scroll") ?? undefined;
    if (!scrollEl) return;
    scrollEl.setAttribute("role", "region");
    scrollEl.setAttribute("tabIndex", "0");
    scrollEl.setAttribute("aria-label", RISK_SCROLL_LABEL);
    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    measure();
    const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    resize?.observe(scrollEl);
    onCleanup(() => {
      scrollEl?.removeEventListener("scroll", handleScroll);
      resize?.disconnect();
    });
  });

  const riskColumns: TableColumnDef<RiskRow>[] = [
    {
      id: "sector",
      header: "Sector",
      accessorKey: "name",
      size: 160,
      meta: { align: "left" },
      cell: ({ row }) => (
        <Text className="text-ui-micro font-semibold whitespace-nowrap">{row.original.name}</Text>
      ),
    },
    {
      id: "max_drawdown",
      header: "Max DD",
      accessorKey: "max_drawdown",
      size: 76,
      meta: { align: "right" },
      cell: ({ row }) => {
        const value = row.original.max_drawdown;
        return (
          <Text
            c={value == null ? "dimmed" : value < 0 ? "error" : "default"}
            className="text-ui-micro font-mono tabular-nums"
          >
            {value == null ? DASH : formatPercentage(value, 1)}
          </Text>
        );
      },
    },
    {
      id: "current_drawdown",
      header: "Current DD",
      accessorKey: "current_drawdown",
      size: 88,
      meta: { align: "right" },
      cell: ({ row }) => {
        const value = row.original.current_drawdown;
        return (
          <Text
            c={value == null ? "dimmed" : value < 0 ? "error" : "default"}
            className="text-ui-micro font-mono tabular-nums"
          >
            {value == null
              ? DASH
              : value === 0
                ? formatPercentage(value, 1, false)
                : formatPercentage(value, 1)}
          </Text>
        );
      },
    },
    {
      id: "recovery_days",
      header: "Recovery days",
      accessorKey: "recovery_days",
      size: 96,
      meta: { align: "right" },
      cell: ({ row }) => {
        const value = row.original.recovery_days;
        return (
          <Text
            c={value == null ? "dimmed" : "default"}
            className="text-ui-micro font-mono tabular-nums"
          >
            {value == null ? DASH : `${value}d`}
          </Text>
        );
      },
    },
    {
      id: "sharpe",
      header: "Sharpe",
      accessorKey: "sharpe",
      size: 68,
      meta: { align: "right" },
      cell: ({ row }) => {
        const value = row.original.sharpe;
        return (
          <Text
            c={value == null ? "dimmed" : value >= 0 ? "success" : "error"}
            className="text-ui-micro font-mono tabular-nums"
          >
            {value == null ? DASH : value.toFixed(2)}
          </Text>
        );
      },
    },
    {
      id: "volatility",
      header: "Vol",
      accessorKey: "volatility",
      size: 68,
      meta: { align: "right" },
      cell: ({ row }) => {
        const value = row.original.volatility;
        return (
          <Text
            c={value == null ? "dimmed" : "default"}
            className="text-ui-micro font-mono tabular-nums"
          >
            {value == null ? DASH : formatPercentage(value, 1, false)}
          </Text>
        );
      },
    },
    {
      id: "spark",
      header: "Cumulative return",
      size: 152,
      enableSorting: false,
      meta: { align: "center" },
      cell: ({ row }) => {
        const final = cumulativeReturn(row.original.spark);
        const value = final == null ? DASH : formatPercentage(final, 1);
        const label =
          final == null ? "Cumulative return unavailable" : `Cumulative return ${value}`;
        return (
          <div
            class="flex items-center justify-center gap-1 leading-none"
            title={label}
            data-testid={`sector-history-risk-spark-${row.original.name}`}
            aria-label={label}
          >
            <MiniSparkline values={row.original.spark} width={80} height={18} />
            <span
              class={`text-ui-micro font-mono tabular-nums whitespace-nowrap ${
                final == null
                  ? "text-fin-text-muted"
                  : final >= 0
                    ? "text-fin-positive"
                    : "text-fin-negative"
              }`}
            >
              {value}
            </span>
          </div>
        );
      },
    },
  ];

  return (
    <div
      ref={(node) => {
        host = node;
      }}
      class="min-w-0"
    >
      <style data-testid="sector-history-risk-sticky-style">{RISK_STICKY_STYLE}</style>
      <div
        aria-hidden="true"
        data-testid="sector-history-risk-scroll-hint"
        class={`mb-1 items-center justify-end ${overflowing() && !atEnd() ? "flex" : "hidden"}`}
      >
        <span class="text-ui-micro text-fin-text-muted">Scroll →</span>
      </div>
      <TanStackTable<RiskRow>
        data={rows()}
        columns={riskColumns}
        dataTestId="sector-history-risk-table"
        ariaLabel={RISK_SCROLL_LABEL}
        emptyMessage="No risk metrics"
        dense
        stickyHeader
        rowWindowSize={40}
        minTableWidth={640}
      />
    </div>
  );
}
