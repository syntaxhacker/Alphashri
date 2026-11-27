import { createEffect, createMemo, createSignal, onCleanup, Show, type JSX } from "solid-js";
import { Badge, Text } from "@/ui";
import { cn } from "@/ui/cn";
import * as palette from "@/ui/palette";
import { TanStackTable, type TableColumnDef } from "../common/TanStackTable";
import { DashCell, NumCell, TextCell } from "../common/tableCells";
import { symbolRowCursor, symbolRowProps, type SymbolOpenHandler } from "../common/symbolRowProps";
import { InlineLoader } from "../common/states";
import { formatNumber, formatPercentage, getPnLTextColor } from "../../utils/ui-helpers";
import { displaySymbol } from "@/config/tvSymbols";
import type { SectionDefinition } from "../../state/sections/types";

export interface SectionScanRow {
  symbol: string;
  name: string;
  fields: Record<string, number | string | null>;
  signals: Record<string, boolean>;
}

const FIELD_LABELS: Record<string, string> = {
  close: "LTP",
  VWAP: "VWAP",
  "change|1": "Δ 1M",
  "change|5": "Δ 5M",
  "change|15": "Δ 15M",
  "volume_change|5": "VOL Δ 5M",
  relative_volume_10d_calc: "RVOL 10D",
  average_volume_10d_calc: "AVG VOL 10D",
  price_52_week_high: "52W HIGH",
  price_52_week_low: "52W LOW",
  EMA20: "EMA20",
  EMA50: "EMA50",
  market_cap_basic: "MCAP",
  update_mode: "MODE",
};

const PERCENT_FIELDS = new Set(["change|1", "change|5", "change|15", "volume_change|5"]);
const MULTIPLIER_FIELDS = new Set(["relative_volume_10d_calc"]);
const COMPACT_FIELDS = new Set(["average_volume_10d_calc", "market_cap_basic"]);
const TEXT_FIELDS = new Set(["update_mode"]);

// TanStackTable paints its one horizontal "Scroll →" cue in a 16px lane above
// the scrollport; the wash starts below it so the cue is never muted.
const SCROLL_CUE_LANE_PX = 16;
const EDGE_FADE_PX = 24;
const EDGE_FADE_STYLE: JSX.CSSProperties = {
  position: "absolute",
  top: `${SCROLL_CUE_LANE_PX}px`,
  right: 0,
  bottom: 0,
  width: `${EDGE_FADE_PX}px`,
  "pointer-events": "none",
  "z-index": 10,
  background: `linear-gradient(to right, ${palette.alpha(palette.SURFACE, 0)}, ${palette.SURFACE})`,
};

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.toUpperCase();
}

function formatField(field: string, value: number): string {
  if (PERCENT_FIELDS.has(field)) return formatPercentage(value);
  if (MULTIPLIER_FIELDS.has(field)) return `${value.toFixed(2)}×`;
  if (COMPACT_FIELDS.has(field)) return formatNumber(value);
  return value.toFixed(2);
}

type SectionState = "error" | "loading" | "empty";

function StateView(props: {
  kind: SectionState;
  section: SectionDefinition;
  error?: string | null;
}): JSX.Element {
  const id = () => `${props.kind}-${props.section.id}`;
  const title = () => {
    if (props.kind === "error") return `Could not scan ${props.section.name}`;
    if (props.kind === "loading") return "Scanning";
    return "No matches";
  };
  // A state always carries one concrete reason: a scan failure names the
  // failure, an empty result says what produced no rows, never a bare shrug.
  const reason = () => {
    if (props.kind === "error") return props.error?.trim() || "The scan failed before any rows were returned.";
    if (props.kind === "loading") return `Scanning ${props.section.name}…`;
    return `No symbols matched ${props.section.name} in the latest scan.`;
  };
  return (
    <div
      class="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 overflow-y-auto px-2 py-2 text-center"
      data-testid={`section-table-${id()}`}
      data-section-state={props.kind}
    >
      <Show when={props.kind === "loading"}>
        <InlineLoader size="sm" showSpinner message="" />
      </Show>
      <Text size="xs" fw={600} className="text-ui-micro text-fin-text">
        {title()}
      </Text>
      <Text
        size="xs"
        className="text-ui-micro text-fin-text-muted"
        data-testid={`section-table-reason-${id()}`}
        title={reason()}
      >
        {reason()}
      </Text>
    </div>
  );
}

function buildSectionColumns(
  section: SectionDefinition,
  fields: string[],
  withSignals: boolean,
  onOpenSymbol?: SymbolOpenHandler,
): TableColumnDef<SectionScanRow>[] {
  const built: TableColumnDef<SectionScanRow>[] = [
    {
      id: "symbol",
      header: "SYMBOL",
      size: 88,
      accessorFn: (row) => row.symbol,
      meta: { align: "left" },
      cell: ({ row }) => {
        const symbol = row.original.symbol;
        const label = displaySymbol(symbol);
        return (
          <Text
            size="xs"
            fw={700}
            span
            truncate
            data-testid={`section-symbol-${symbol}`}
            title={onOpenSymbol ? `Open ${label} chart` : undefined}
            className={cn(
              "text-left min-w-0",
              onOpenSymbol && "hover:text-fin-primary focus-visible:underline",
            )}
            style={{ cursor: symbolRowCursor(onOpenSymbol) }}
            {...symbolRowProps(onOpenSymbol, label)}
          >
            {label}
          </Text>
        );
      },
    },
    {
      id: "name",
      header: "NAME",
      size: 108,
      accessorFn: (row) => row.name,
      meta: { align: "left" },
      cell: ({ row }) => <TextCell value={row.original.name} dimmed truncate />,
    },
  ];
  for (const field of fields) {
    const align = TEXT_FIELDS.has(field) ? "left" : "right";
    built.push({
      id: field,
      header: fieldLabel(field),
      size: TEXT_FIELDS.has(field) ? 100 : 88,
      accessorFn: (row) => row.fields[field] ?? null,
      meta: { align },
      cell: ({ row }) => {
        const value = row.original.fields[field];
        if (typeof value === "number" && Number.isFinite(value)) {
          return (
            <NumCell
              value={value}
              align={align}
              format={(number) => formatField(field, number)}
              tone={PERCENT_FIELDS.has(field) ? getPnLTextColor(value) : undefined}
              testId={`section-${field}-${row.original.symbol}`}
            />
          );
        }
        if (typeof value === "string" && value.length > 0) {
          return <TextCell value={value} testId={`section-${field}-${row.original.symbol}`} />;
        }
        return <DashCell testId={`section-${field}-${row.original.symbol}`} />;
      },
    });
  }
  if (withSignals) {
    built.push({
      id: "signal",
      header: "SIGNAL",
      size: 72,
      enableSorting: false,
      // A row can carry flags for other sections from the same scan. Only this
      // section's flag may earn the MATCH badge, or a card could badge a row
      // its own heading does not count.
      accessorFn: (row) => row.signals?.[section.id] === true,
      meta: { align: "center" },
      cell: ({ row }) =>
        row.original.signals?.[section.id] === true ? (
          <div class="flex items-center justify-center">
            <Badge size="xs" variant="light" color="primary">
              MATCH
            </Badge>
          </div>
        ) : (
          <DashCell />
        ),
    });
  }
  return built;
}

/**
 * The only section result renderer: Home windows and the Screener Sections
 * tab both mount this. States replace the table rather than leaving an empty
 * grid behind, and the panel owns one border and one scroll container.
 */
export function SectionTable(props: {
  section: SectionDefinition;
  rows: SectionScanRow[];
  loading?: boolean;
  error?: string | null;
  dense?: boolean;
  /** The Screener card owns the border; a standalone mount keeps its own. */
  borderless?: boolean;
  onOpenSymbol?: SymbolOpenHandler;
}): JSX.Element {
  const hasSignals = createMemo(() =>
    props.rows.some((row) => row.signals?.[props.section.id] === true),
  );
  const state = createMemo<SectionState | null>(() => {
    if (props.error?.trim()) return "error";
    if (props.loading) return "loading";
    if (props.rows.length === 0) return "empty";
    return null;
  });
  const [atScrollEnd, setAtScrollEnd] = createSignal(true);
  let panelEl: HTMLDivElement | undefined;

  // The wash belongs to the table's own scrollport — the single scroll owner.
  // Rebind it when a named state swaps the table for a status view.
  createEffect(() => {
    state();
    const viewport = panelEl?.querySelector<HTMLElement>(".paper-tanstack-scroll");
    if (!viewport) {
      setAtScrollEnd(true);
      return;
    }
    const sync = () => {
      const max = viewport.scrollWidth - viewport.clientWidth;
      setAtScrollEnd(max <= 2 || viewport.scrollLeft >= max - 2);
    };
    viewport.addEventListener("scroll", sync, { passive: true });
    sync();
    onCleanup(() => viewport.removeEventListener("scroll", sync));
  });
  const builtColumns = createMemo(() => {
    const fields = Array.from(new Set(props.section.render.columns ?? [])).filter(
      (field) => field !== "symbol" && field !== "name",
    );
    return buildSectionColumns(props.section, fields, hasSignals(), props.onOpenSymbol);
  });

  return (
    <div
      ref={(el) => {
        panelEl = el;
      }}
      class={cn(
        "relative flex min-h-0 flex-1 flex-col overflow-hidden bg-fin-surface",
        !props.borderless && "rounded-fin border border-fin-border",
      )}
      data-testid={`section-panel-${props.section.id}`}
      data-edge-fade={!atScrollEnd() ? "right" : undefined}
    >
      <Show
        when={state()}
        fallback={
          <TanStackTable<SectionScanRow>
            data={props.rows}
            columns={builtColumns()}
            dataTestId={`section-table-${props.section.id}`}
            ariaLabel={`${props.section.name} results`}
            dense={props.dense}
            fillContainer
            bare
            stickyHeader
            getRowKey={(row) => row.symbol}
            getRowTestId={(row) => `section-row-${row.symbol}`}
          />
        }
      >
        {(kind) => (
          <StateView kind={kind()} section={props.section} error={props.error} />
        )}
      </Show>
      <Show when={!atScrollEnd()}>
        <div
          data-testid={`section-table-edge-fade-${props.section.id}`}
          aria-hidden="true"
          class="pointer-events-none absolute z-10"
          style={EDGE_FADE_STYLE}
        />
      </Show>
    </div>
  );
}
