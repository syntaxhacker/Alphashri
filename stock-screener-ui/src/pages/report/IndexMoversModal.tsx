import { createEffect, createMemo, createSignal, Show, onCleanup } from "solid-js";
import { TanStackTable, type TableColumnDef } from "@/components/common/TanStackTable";
import { NumCell, SymbolCell } from "@/components/common/tableCells";
import { LocalPanelModal } from "./LocalPanelModal";
import * as palette from "@/ui/palette";
import { Loader, Text, SegmentedControl, Button, Tooltip } from "@/ui";
import { formatNumberIN } from "@/utils/ui-helpers";
import { fetchIndexMovers, IndexMoversResponse, IndexMoverRow } from "@/api/indexMovers";
import { useSymbolDock } from "@/components/common/symbolDockContext";

interface IndexMoversModalProps {
  open: boolean;
  onClose: () => void;
  index: "NIFTY" | "SENSEX";
  /** Constituent symbol → app-wide chart dock. */
  onOpenSymbol?: (symbol: string) => void;
}

function formatSignedPct(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

interface MoversTableRow extends IndexMoverRow {
  rank: number;
  absChange: number;
}

const TABS = [
  { value: "gainers", label: "GAINERS" },
  { value: "losers", label: "LOSERS" },
  { value: "all", label: "ALL" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

function MoversTable(props: {
  rows: MoversTableRow[];
  index: "NIFTY" | "SENSEX";
  onOpenSymbol: (symbol: string) => void;
}) {
  const columns = createMemo<TableColumnDef<MoversTableRow>[]>(() => [
    {
      id: "rank",
      header: "RANK",
      accessorKey: "rank",
      size: 50,
      meta: { align: "right" },
      cell: ({ row }) => (
        <NumCell value={row.original.rank} fw={600} tone="dimmed" format={(v) => String(v)} />
      ),
    },
    {
      id: "symbol",
      header: "SYMBOL",
      accessorKey: "symbol",
      size: 120,
      meta: { align: "left" },
      cell: ({ row }) => (
        <SymbolCell symbol={row.original.symbol} onOpen={props.onOpenSymbol} />
      ),
    },
    {
      id: "ltp",
      header: "LTP",
      accessorKey: "ltp",
      size: 90,
      meta: { align: "right" },
      cell: ({ row }) => (
        <NumCell value={row.original.ltp} fw={600} format={formatNumberIN} />
      ),
    },
    {
      id: "change_pct",
      header: "CHANGE %",
      accessorKey: "change_pct",
      size: 90,
      meta: { align: "right" },
      cell: ({ row }) => (
        <NumCell value={row.original.change_pct} signed fw={700} format={formatSignedPct} />
      ),
    },
    {
      id: "contribution_pct",
      header: "CONTRIB %",
      accessorKey: "contribution_pct",
      size: 90,
      meta: { align: "right" },
      cell: ({ row }) => (
        <NumCell value={row.original.contribution_pct} signed fw={600} format={formatSignedPct} />
      ),
    },
    {
      id: "volume",
      header: "VOLUME",
      accessorKey: "volume",
      size: 110,
      meta: { align: "right" },
      cell: ({ row }) => (
        <NumCell value={row.original.volume} tone="dimmed" format={formatNumberIN} />
      ),
    },
  ]);

  return (
    <TanStackTable<MoversTableRow>
      data={props.rows}
      columns={columns()}
      dataTestId="movers-table"
      enableSorting={false}
      initialState={{ sorting: [{ id: "change_pct", desc: true }] }}
      dense
      fillContainer
      minTableWidth={560}
      getRowAttributes={(row) => ({
        dataMoverRank: row.rank,
        dataMoverSymbol: row.symbol,
      })}
    />
  );
}

export function IndexMoversModal(props: IndexMoversModalProps) {
  const open = () => props.open;
  const index = () => props.index;
  const dock = useSymbolDock();
  // NIFTY 50 / SENSEX 30 are symbol chips: open the canonical index chart in
  // the app-wide dock, never switch the report's underlying Select.
  const openIndex = (value: "NIFTY" | "SENSEX") =>
    dock.open(value === "SENSEX" ? "SENSEX" : "NIFTY");
  const openSymbol = (symbol: string) =>
    (props.onOpenSymbol ?? ((s) => dock.open(s)))(symbol);
  const [data, setData] = createSignal<IndexMoversResponse | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [tab, setTab] = createSignal<TabValue>("gainers");
  let abortController: AbortController | null = null;
  let mounted = true;

  createEffect(() => {
    if (!open()) return;
    index();
    mounted = true;
    abortController?.abort();
    const controller = new AbortController();
    abortController = controller;
    setLoading(true);
    setError(null);
    fetchIndexMovers(index(), "all", controller.signal)
      .then((res) => {
        if (!mounted || controller.signal.aborted) return;
        setData(res);
      })
      .catch((e) => {
        if (!mounted || controller.signal.aborted) return;
        if (e instanceof Error && e.message === "MOVERS_UNAVAILABLE") {
          setError("unavailable");
        } else {
          setError(e instanceof Error ? e.message : "Failed to load movers");
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    onCleanup(() => {
      mounted = false;
      controller.abort();
    });
  });

  const rows = createMemo(() => {
    const d = data();
    if (!d) return [];
    const t = tab();
    let source: IndexMoverRow[];
    if (t === "gainers") source = d.gainers;
    else if (t === "losers") source = d.losers;
    else source = [...d.gainers, ...d.losers].sort((a, b) => b.change_pct - a.change_pct);

    return source.map((r, i) => ({
      ...r,
      rank: i + 1,
      absChange: Math.abs(r.change_pct),
    }));
  });

  const isStale = () => data()?.stale === true;

  return (
    <LocalPanelModal
      open={open()}
      title={
        <button
          type="button"
          data-testid="movers-index"
          title={`Open ${index()} index report`}
          onClick={() => openIndex(index())}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            openIndex(index());
          }}
          class="cursor-pointer border-0 bg-transparent p-0 font-mono text-ui-title font-extrabold tracking-[0.08em] text-fin-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fin-primary"
        >
          MOVERS · {index()} {index() === "NIFTY" ? "50" : "30"}
        </button>
      }
      onClose={props.onClose}
      maxWidth={720}
      autoHeight
      maxHeight="75vh"
      actions={
        <div class="flex items-center gap-2">
          <SegmentedControl
            value={tab()}
            onChange={(v) => setTab(v as TabValue)}
            data={[...TABS]}
            size="xs"
            className="min-w-0"
          />
          <Show when={isStale()}>
            <Tooltip label="Data is stale — quotes may be delayed">
              <span
                class="inline-flex items-center gap-1 px-[2px] py-[1px] rounded-sm text-ui-micro font-bold tracking-[0.05em] whitespace-nowrap"
                style={{
                  border: `1px solid ${palette.WARNING}`,
                  color: palette.WARNING,
                }}
              >
                STALE
              </span>
            </Tooltip>
          </Show>
        </div>
      }
    >
      <Show when={loading() && !data()}>
        <div
          class="flex items-center justify-center min-h-[120px] text-fin-text-muted"
        >
          <Loader size="xs" color={palette.PRIMARY} />
          <Text span size="xs" c="dimmed" style={{ "margin-left": "8px" }}>
            loading movers…
          </Text>
        </div>
      </Show>

      <Show when={error() && !data()}>
        <div
          class="flex items-center justify-center min-h-[120px] gap-2 flex-wrap"
        >
          <Text span size="xs" c="error" fw={700} data-report-text="value" class="text-ui-body">
            unavailable
          </Text>
          <Button size="sm" variant="subtle" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </Show>

      <Show when={data() && rows().length === 0}>
        <div class="flex items-center justify-center min-h-[120px] text-fin-text-muted">
          <Text span size="xs" c="dimmed">
            No movers data
          </Text>
        </div>
      </Show>

      <Show when={data() && rows().length > 0}>
        <div class="min-w-0">
          <MoversTable rows={rows()} index={index()} onOpenSymbol={openSymbol} />
        </div>
      </Show>

      {/* Footer meta */}
      <Show when={data()}>
        <div
          data-testid="movers-modal-footer"
          data-report-spacing="8"
          class="flex items-center justify-between gap-2 flex-wrap mt-2 pt-2 border-t border-fin-border font-mono text-ui-micro text-fin-text-muted"
        >
          <span data-testid="movers-modal-source" class="inline-flex items-baseline gap-2 min-w-0">
            <span data-report-text="label" class="text-ui-micro">Source:</span>
            <span data-report-text="value" class="text-ui-body text-fin-text whitespace-nowrap">
              {data()!.source}
            </span>
          </span>
          <span data-testid="movers-modal-asof" class="inline-flex items-baseline gap-2 min-w-0">
            <span data-report-text="label" class="text-ui-micro">As of:</span>
            <span data-report-text="value" class="text-ui-body text-fin-text tabular-nums whitespace-nowrap">
              {new Date(data()!.as_of).toLocaleTimeString("en-IN", {
                hour12: false,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                timeZone: "Asia/Kolkata",
              })}
            </span>
          </span>
        </div>
      </Show>
    </LocalPanelModal>
  );
}
