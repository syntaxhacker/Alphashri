import { Show } from "solid-js";
import { ActionIcon, Text } from "@/ui";
import { IconChevronDown, IconChevronRight } from "@/components/common/Icons";
import type { TableColumnDef } from "@/components/common/TanStackTable";
import { DashCell, TextCell } from "@/components/common/tableCells";
import { badgeColumn, symbolColumn } from "@/components/table/columns";
import {
  CATALYST_COLUMN_ALIGN,
  confirmationFacts,
  confirmationSortValue,
  formatIstClock,
  rowSectorBreadth,
  type CatalystRowLike,
  type CatalystSectorView,
} from "./catalystRows";

/**
 * Radar column definitions. The toggle, headline and confirmation cells are
 * genuinely bespoke (expansion registration and two-line composites), so they
 * live in this co-located `*.columns.tsx` — the structural guard's documented
 * home for columns the generic factories cannot express. Columns whose data
 * does fit a factory still use one, with `meta.align` pinned to the shared
 * catalyst alignment map so it cannot drift from the bespoke columns.
 */

const STATE_TONE: Record<string, string> = {
  scheduled: "secondary",
  breaking: "info",
  confirmed: "primary",
  fading: "dimmed",
};

const SCORE_TONE: Record<string, string> = {
  high: "primary",
  medium: "secondary",
  low: "dimmed",
};

function stateTone(state: string | null | undefined): string {
  return STATE_TONE[(state ?? "").toLowerCase()] ?? "secondary";
}

function scoreTone(score: string | null | undefined): string {
  return SCORE_TONE[(score ?? "").toLowerCase()] ?? "dimmed";
}

export function upper(value: string | null | undefined, fallback = "—"): string {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? fallback : trimmed.toUpperCase();
}

export function joinOrDash(parts: (string | null | undefined)[]): string {
  const present = parts.filter((part): part is string => part != null && part !== "");
  return present.length > 0 ? present.join(" · ") : "—";
}

export interface RadarColumnContext {
  narrow: boolean;
  sector: CatalystSectorView | null;
  rowToggles: WeakMap<CatalystRowLike, () => void>;
}

export function buildRadarColumns(ctx: RadarColumnContext): TableColumnDef<CatalystRowLike>[] {
  const columns: TableColumnDef<CatalystRowLike>[] = [
    {
      id: "toggle",
      header: "",
      meta: { align: "center" },
      enableSorting: false,
      size: 24,
      cell: ({ row }) => {
        ctx.rowToggles.set(row.original, row.toggle);
        return (
          <ActionIcon
            variant="subtle"
            color="secondary"
            size="xs"
            aria-label={row.isExpanded() ? "Collapse catalyst" : "Expand catalyst"}
            aria-expanded={row.isExpanded()}
            data-testid={`catalyst-toggle-${row.original.symbol}`}
            onClick={(event: MouseEvent) => {
              event.stopPropagation();
              row.toggle();
            }}
          >
            {row.isExpanded() ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
          </ActionIcon>
        );
      },
    },
    {
      ...symbolColumn<CatalystRowLike>({
        id: "symbol",
        header: "Symbol",
        size: 74,
        name: (row) => row.name,
        cellTestId: (row) => `catalyst-symbol-${row.symbol}`,
      }),
      meta: { align: CATALYST_COLUMN_ALIGN.symbol },
    },
    {
      id: "catalyst",
      header: "Catalyst",
      accessorKey: "headline",
      meta: { align: CATALYST_COLUMN_ALIGN.catalyst },
      size: 174,
      cell: ({ row }) => {
        const headline =
          row.original.headline?.trim() ||
          row.original.reasons?.[0]?.trim() ||
          "No qualifying headline";
        return (
          <div className="flex min-w-0 flex-col leading-tight text-left">
            <TextCell
              value={headline}
              title={headline}
              testId={`catalyst-headline-${row.original.symbol}`}
            />
            <Text component="span" c="dimmed" truncate className="text-left text-ui-micro">
              {joinOrDash([row.original.source, upper(row.original.kind, "")])}
            </Text>
          </div>
        );
      },
    },
    {
      id: "first_seen",
      header: "First seen",
      accessorKey: "first_seen",
      meta: { align: CATALYST_COLUMN_ALIGN.first_seen },
      size: 58,
      cell: ({ row }) => (
        <Text
          component="span"
          className="text-left font-mono tabular-nums text-ui-micro"
          data-testid={`catalyst-first-seen-${row.original.symbol}`}
        >
          {formatIstClock(row.original.first_seen)}
        </Text>
      ),
    },
    {
      ...badgeColumn<CatalystRowLike>({
        id: "state",
        header: "State",
        size: 82,
        label: (row) => upper(row.state),
        color: (row) => stateTone(row.state),
        cellTestId: (row) => `catalyst-state-${row.symbol}`,
      }),
      meta: { align: CATALYST_COLUMN_ALIGN.state },
    },
    {
      id: "confirmation",
      header: "Confirmation",
      accessorFn: (row) => confirmationSortValue(row),
      meta: { align: CATALYST_COLUMN_ALIGN.confirmation },
      size: 124,
      cell: ({ row }) => {
        const breadth = rowSectorBreadth(row.original, ctx.sector);
        const facts = confirmationFacts(row.original, breadth);
        const measured = [facts.move, facts.volume].filter(
          (part): part is string => part != null,
        );
        return (
          <div className="flex min-w-0 flex-col items-end leading-tight">
            <Show
              when={measured.length > 0 || facts.breadth != null}
              fallback={<DashCell testId={`catalyst-confirmation-${row.original.symbol}`} />}
            >
              <Text
                component="span"
                truncate
                className="max-w-full text-right font-mono tabular-nums text-ui-micro"
                data-testid={`catalyst-confirmation-${row.original.symbol}`}
              >
                {measured.join(" · ") || "—"}
              </Text>
              <Show when={facts.breadth}>
                <Text component="span" c="dimmed" truncate className="max-w-full text-right text-ui-micro">
                  {facts.breadth}
                </Text>
              </Show>
            </Show>
          </div>
        );
      },
    },
    {
      ...badgeColumn<CatalystRowLike>({
        id: "score",
        header: "Score",
        size: 58,
        label: (row) => upper(row.score),
        color: (row) => scoreTone(row.score),
        cellTestId: (row) => `catalyst-score-${row.symbol}`,
      }),
      meta: { align: CATALYST_COLUMN_ALIGN.score },
    },
  ];

  // A 320px pane cannot show seven columns and still be readable. First seen
  // and State remain in the expanded detail; the live confirmation and score
  // are the two columns worth keeping on a phone.
  if (!ctx.narrow) return columns;
  const widths: Record<string, number> = {
    toggle: 20,
    symbol: 60,
    catalyst: 128,
    confirmation: 92,
    score: 48,
  };
  return columns
    .filter((column) => column.id !== "first_seen" && column.id !== "state")
    .map((column) => ({ ...column, size: widths[column.id ?? ""] ?? column.size }));
}
