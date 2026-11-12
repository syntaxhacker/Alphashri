import { createEffect, createMemo, createSignal, Show, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import { TanStackTable, type TableColumnDef } from "@/components/common/TanStackTable";
import { LocalPanelModal } from "./LocalPanelModal";
import * as palette from "@/ui/palette";
import { Loader, Text, SegmentedControl, Button, Tooltip } from "@/ui";
import { formatNumberIN } from "@/utils/ui-helpers";
import {
  REPORT_FONT,
} from "./reportTokens";
import { fetchIndexMovers, IndexMoversResponse, IndexMoverRow } from "@/api/indexMovers";

interface IndexMoversModalProps {
  open: boolean;
  onClose: () => void;
  index: "NIFTY" | "SENSEX";
}

const GAINER_COLOR = palette.POSITIVE;
const LOSER_COLOR = palette.NEGATIVE;

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
}) {
  const columns = createMemo<TableColumnDef<MoversTableRow>[]>(() => [
    {
      header: "RANK",
      accessorKey: "rank",
      size: 50,
      meta: { align: "center" },
      cell: ({ row }) => (
        <Text
          span
          size="xs"
          fw={600}
          style={{
            fontSize: REPORT_FONT.xs,
            fontVariantNumeric: "tabular-nums",
            color: palette.TEXT_MUTED,
            fontFamily: palette.MONO,
          }}
        >
          {String(row.original.rank)}
        </Text>
      ),
    },
    {
      header: "SYMBOL",
      accessorKey: "symbol",
      size: 120,
      meta: { align: "left" },
      cell: ({ row }) => (
        <Text
          span
          size="xs"
          fw={700}
          style={{
            fontSize: REPORT_FONT.sm,
            fontVariantNumeric: "tabular-nums",
            fontFamily: palette.MONO,
          }}
        >
          {row.original.symbol}
        </Text>
      ),
    },
    {
      header: "LTP",
      accessorKey: "ltp",
      size: 90,
      meta: { align: "right" },
      cell: ({ row }) => (
        <Text
          span
          size="xs"
          fw={600}
          style={{
            fontSize: REPORT_FONT.sm,
            fontVariantNumeric: "tabular-nums",
            fontFamily: palette.MONO,
          }}
        >
          {formatNumberIN(row.original.ltp)}
        </Text>
      ),
    },
    {
      header: "CHANGE %",
      accessorKey: "change_pct",
      size: 90,
      meta: { align: "right" },
      cell: ({ row }) => {
        const val = row.original.change_pct;
        const isGainer = val > 0;
        return (
          <Text
            span
            size="xs"
            fw={700}
            style={{
              fontSize: REPORT_FONT.sm,
              fontVariantNumeric: "tabular-nums",
              fontFamily: palette.MONO,
              color: isGainer ? GAINER_COLOR : LOSER_COLOR,
            }}
          >
            {isGainer ? "+" : ""}{val.toFixed(2)}%
          </Text>
        );
      },
    },
    {
      header: "CONTRIB %",
      accessorKey: "contribution_pct",
      size: 90,
      meta: { align: "right" },
      cell: ({ row }) => {
        const val = row.original.contribution_pct;
        if (val === undefined || val === null) {
          return (
            <Text
              span
              size="xs"
              c="dimmed"
              style={{
                fontSize: REPORT_FONT.sm,
                fontVariantNumeric: "tabular-nums",
                fontFamily: palette.MONO,
              }}
            >
              —
            </Text>
          );
        }
        const isGainer = val > 0;
        return (
          <Text
            span
            size="xs"
            fw={600}
            style={{
              fontSize: REPORT_FONT.sm,
              fontVariantNumeric: "tabular-nums",
              fontFamily: palette.MONO,
              color: isGainer ? GAINER_COLOR : LOSER_COLOR,
            }}
          >
            {isGainer ? "+" : ""}{val.toFixed(2)}%
          </Text>
        );
      },
    },
    {
      header: "VOLUME",
      accessorKey: "volume",
      size: 110,
      meta: { align: "right" },
      cell: ({ row }) => (
        <Text
          span
          size="xs"
          c="dimmed"
          style={{
            fontSize: REPORT_FONT.xs,
            fontVariantNumeric: "tabular-nums",
            fontFamily: palette.MONO,
          }}
        >
          {formatNumberIN(row.original.volume)}
        </Text>
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
  const [data, setData] = createSignal<IndexMoversResponse | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [tab, setTab] = createSignal<TabValue>("gainers");
  let abortController: AbortController | null = null;
  let mounted = true;

  // Load all movers when modal opens
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

  // Derive rows for current tab
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

  // Stale badge
  const isStale = () => data()?.stale === true;

  return (
    <LocalPanelModal
      open={open()}
      title={`MOVERS · ${index()} ${index() === "NIFTY" ? "50" : "30"}`}
      onClose={props.onClose}
      maxWidth={720}
      autoHeight
      maxHeight="75vh"
      actions={
        <div class="flex items-center gap-1">
          <SegmentedControl
            value={tab()}
            onChange={(v) => setTab(v as TabValue)}
            data={TABS}
            size="xs"
            class="min-w-0"
          />
          <Show when={isStale()}>
            <Tooltip label="Data is stale — quotes may be delayed">
              <span
                class="inline-flex items-center gap-1 px-[2px] py-[1px] rounded-sm text-[10px] font-bold tracking-[0.05em] whitespace-nowrap"
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
          <Text span size="xs" c="dimmed" style={{ marginLeft: 8 }}>
            loading movers…
          </Text>
        </div>
      </Show>

      <Show when={error() && !data()}>
        <div
          class="flex items-center justify-center min-h-[120px] gap-2 flex-wrap"
        >
          <Text span size="xs" c="error" fw={700}>
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
          <MoversTable rows={rows()} index={index()} />
        </div>
      </Show>

      {/* Footer meta */}
      <Show when={data()}>
        <div
          class="flex items-center justify-between mt-2 pt-1 border-t border-fin-border font-mono text-[10px] text-fin-text-muted"
        >
          <Text span size="xs" c="dimmed">
            Source: {data()!.source}
          </Text>
          <Text span size="xs" c="dimmed">
            As of: {new Date(data()!.as_of).toLocaleTimeString("en-IN", {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              timeZone: "Asia/Kolkata",
            })}
          </Text>
        </div>
      </Show>
    </LocalPanelModal>
  );
}
