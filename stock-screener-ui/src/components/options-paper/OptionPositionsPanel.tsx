import { createMemo, createSignal, onMount, Show } from "solid-js";
import { Badge, Box, Button, Text, ToolbarRow, typeSize } from "@/ui";
import {
  TanStackTable,
  type TableColumnDef,
} from "@/components/common/TanStackTable";
import { EmptyState, ErrorAlert, InlineLoader } from "@/components/common/states";
import { PnlText } from "@/components/common/PnlText";
import { useStoreSnapshot } from "@/hooks/useStoreSubscription";
import { fetchOptionPaperPositions } from "@/api/optionsPaper";
import {
  getOptionsPaperState,
  setError,
  setLoading,
  setPositions,
  setSelectedPosition,
  subscribe,
} from "@/state/optionsPaper";
import { formatCurrencyCompact, formatSignedPnl } from "@/utils/ui-helpers";
import { reducedMotionClass, transitionClass } from "@/pages/options-replay/replayMotion";
import type { OptionPaperPosition } from "@/types/optionsPaper";
import { AddLegDialog } from "./AddLegDialog";

const MAX_LEGS = 4;

function legSummary(position: OptionPaperPosition): string {
  if (position.legs.length === 0) return "—";
  const parts = position.legs.map(
    (leg) => `${leg.action} ${leg.optType} ${leg.strike.toLocaleString("en-IN")}`,
  );
  return `${position.legs.length} legs · ${parts.join(" / ")}`;
}

export function OptionPositionsPanel() {
  const state = useStoreSnapshot(subscribe, getOptionsPaperState);
  const positions = createMemo(() => state().positions);
  const [addLegOpen, setAddLegOpen] = createSignal(false);
  const selectedPosition = createMemo(
    () => positions().find((row) => row.id === state().selectedPositionId) ?? null,
  );
  const canAddLeg = createMemo(() => {
    const position = selectedPosition();
    return position !== null && position.legs.length < MAX_LEGS;
  });

  onMount(() => {
    setLoading(true);
    void fetchOptionPaperPositions("all")
      .then(setPositions)
      .catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : String(failure));
      })
      .finally(() => setLoading(false));
  });

  const positionColumns: TableColumnDef<OptionPaperPosition>[] = [
    {
      id: "structure",
      header: "UNDERLYING / EXPIRY",
      accessorKey: "underlying",
      meta: { align: "left" },
      size: 150,
      cell: ({ row }) => (
        <Box className="flex min-w-0 flex-col">
          <Text size="xs" fw={600} className="truncate">{row.original.underlying}</Text>
          <Text c="dimmed" className="truncate text-ui-micro">{row.original.expiry}</Text>
        </Box>
      ),
    },
    {
      id: "source",
      header: "BOOK",
      accessorKey: "source",
      meta: { align: "center" },
      size: 76,
      cell: ({ row }) => (
        <Badge
          size="sm"
          color={row.original.source === "replay" ? "info" : "primary"}
          variant="light"
          style={{ "font-size": `${typeSize("micro")}px`, height: "18px" }}
        >
          {row.original.source.toUpperCase()}
        </Badge>
      ),
    },
    {
      id: "status",
      header: "STATUS",
      accessorKey: "status",
      meta: { align: "center" },
      size: 84,
      cell: ({ row }) => (
        <Badge
          size="sm"
          color={
            row.original.status === "open"
              ? "success"
              : row.original.status === "expired"
                ? "warning"
                : "neutral"
          }
          variant="light"
          style={{ "font-size": `${typeSize("micro")}px`, height: "18px" }}
        >
          {row.original.status.toUpperCase()}
        </Badge>
      ),
    },
    {
      id: "legs",
      header: "LEGS",
      accessorFn: legSummary,
      meta: { align: "left" },
      size: 260,
      cell: ({ row }) => (
        <Text size="xs" className="truncate">{legSummary(row.original)}</Text>
      ),
    },
    {
      id: "netDebit",
      header: "NET DEBIT",
      accessorKey: "netDebit",
      meta: { align: "right" },
      size: 100,
      cell: ({ row }) => (
        <Text size="xs" className="font-mono tabular-nums">
          {formatCurrencyCompact(row.original.netDebit)}
        </Text>
      ),
    },
    {
      id: "mark",
      header: "MARK",
      accessorKey: "markSpot",
      meta: { align: "right" },
      size: 90,
      cell: ({ row }) => (
        <Text size="xs" className="font-mono tabular-nums">
          {formatCurrencyCompact(row.original.markSpot)}
        </Text>
      ),
    },
    {
      id: "pnl",
      header: "P&L",
      accessorKey: "totalPnl",
      meta: { align: "right" },
      size: 100,
      cell: ({ row }) => (
        <PnlText value={row.original.totalPnl} size="xs">
          {formatSignedPnl(row.original.totalPnl)}
        </PnlText>
      ),
    },
    {
      id: "dte",
      header: "DTE",
      accessorKey: "dte",
      meta: { align: "right" },
      size: 64,
      cell: ({ row }) => (
        <Text size="xs" className="font-mono tabular-nums">{row.original.dte}d</Text>
      ),
    },
  ];

  return (
    <Box data-testid="option-positions-panel" className="flex min-h-0 min-w-0 flex-col">
      <Box
        data-testid="option-positions-header"
        className="flex shrink-0 flex-col gap-1 border-b border-fin-border-subtle px-4 pb-3 pt-4"
      >
        <Text size="lg" fw={600} className="leading-tight">PAPER BOOK</Text>
        <Text c="dimmed" className="text-ui-micro">
          Simulated option structures · no real capital at risk.
        </Text>
      </Box>

      <ToolbarRow gap={8} justify="flex-end" className="shrink-0 px-4 py-3">
        <Button
          size="sm"
          variant="light"
          className="shrink-0"
          disabled={!canAddLeg()}
          onClick={() => setAddLegOpen(true)}
          data-testid="option-positions-add-leg"
          title={selectedPosition() ? "Add a leg to the selected structure" : "Select a position first"}
        >
          ADD LEG
        </Button>
      </ToolbarRow>

      <Show when={state().error}>
        {(message) => (
          <ErrorAlert
            data-testid="option-positions-error"
            title="Positions unavailable"
            message={message()}
          />
        )}
      </Show>

      <Show when={!state().error && state().loading && positions().length === 0}>
        <InlineLoader
          data-testid="option-positions-loading"
          message="Loading option positions…"
          className={`${transitionClass("state")} ${reducedMotionClass()} animate-pulse motion-reduce:animate-none`}
        />
      </Show>

      <Show when={!state().error && !state().loading && positions().length === 0}>
        <EmptyState
          data-testid="option-positions-empty"
          title="No option positions"
          description="Place a paper trade from the options dock to see it here."
        />
      </Show>

      <Show when={positions().length > 0}>
        <Box
          data-testid="option-positions-scroll-hint"
          className="flex shrink-0 items-center gap-2 self-start rounded-[4px] border border-fin-border-subtle bg-fin-surface-alt/60 px-2 py-1 sm:hidden"
        >
          <Text component="span" size="xs" aria-hidden="true" className="text-fin-primary">
            ↔
          </Text>
          <Text c="dimmed" className="text-ui-micro">Scroll horizontally for more columns</Text>
        </Box>
        {/* The shared table writes dense cell metrics inline; override at the
            wrapper so this modal keeps 8/12px padding and a 12px number floor. */}
        <Box
          data-testid="option-positions-table-wrap"
          className="min-h-0 min-w-0 flex-1 [&_td]:px-3! [&_td]:py-2! [&_td]:text-xs! [&_th]:text-ui-micro!"
        >
          <TanStackTable
            data={positions()}
            columns={positionColumns}
            dataTestId="option-positions-table"
            ariaLabel="Option paper positions"
            bare
            getRowTestId={(row) => `option-positions-row-${row.id}`}
            onRowClick={(row) => setSelectedPosition(row.id)}
            getRowClassName={(row) =>
              `${transitionClass("tile")} ${reducedMotionClass()} ${
                state().selectedPositionId === row.id ? "row-selected" : ""
              }`.trim()
            }
          />
        </Box>
      </Show>

      <AddLegDialog
        opened={addLegOpen()}
        position={selectedPosition()}
        onClose={() => setAddLegOpen(false)}
      />
    </Box>
  );
}
