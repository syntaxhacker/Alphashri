import React, { memo, useState, useEffect, useMemo, useRef } from "react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { PanelModal } from "@/components/common/PanelModal";
import { TanStackTable } from "@/components/common/TanStackTable";
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

function MoversTable({
  rows,
  index,
}: {
  rows: MoversTableRow[];
  index: "NIFTY" | "SENSEX";
}) {
  const [_sorting, setSorting] = useState<SortingState>([{ id: "change_pct", desc: true }]);
  const [sortMode, _setSortMode] = useState<"change" | "contribution" | "symbol">("change");

  // Column definitions with explicit meta.align
  const columns = useMemo<ColumnDef<MoversTableRow>[]>(() => [
    {
      header: "RANK",
      accessorKey: "rank",
      size: 50,
      meta: { align: "center" },
      cell: (info) => (
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
          {info.getValue()}
        </Text>
      ),
    },
    {
      header: "SYMBOL",
      accessorKey: "symbol",
      size: 120,
      meta: { align: "left" },
      cell: (info) => (
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
          {info.getValue()}
        </Text>
      ),
    },
    {
      header: "LTP",
      accessorKey: "ltp",
      size: 90,
      meta: { align: "right" },
      cell: (info) => (
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
          {formatNumberIN(info.getValue() as number)}
        </Text>
      ),
    },
    {
      header: "CHANGE %",
      accessorKey: "change_pct",
      size: 90,
      meta: { align: "right" },
      cell: (info) => {
        const val = info.getValue() as number;
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
      cell: (info) => {
        const val = info.getValue() as number | undefined;
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
      cell: (info) => (
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
          {formatNumberIN(info.getValue() as number)}
        </Text>
      ),
    },
  ], [index]);

  // Apply sort based on sortMode
  useEffect(() => {
    if (sortMode === "change") {
      setSorting([{ id: "change_pct", desc: true }]);
    } else if (sortMode === "contribution") {
      setSorting([{ id: "contribution_pct", desc: true }]);
    } else {
      setSorting([{ id: "symbol", desc: false }]);
    }
  }, [sortMode]);

  return (
    <TanStackTable<MoversTableRow>
      data={rows}
      columns={columns}
      dataTestId="movers-table"
      enableSorting={true}
      initialState={{ sorting: [{ id: "change_pct", desc: true }] }}
      onSortingChange={setSorting}
      dense
      fillContainer
      minTableWidth={560}
      getRowAttributes={(row) => ({
        "data-mover-rank": row.rank,
        "data-mover-symbol": row.symbol,
      })}
    />
  );
}

export const IndexMoversModal = memo(function IndexMoversModal({
  open,
  onClose,
  index,
}: IndexMoversModalProps) {
  const [data, setData] = useState<IndexMoversResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabValue>("gainers");
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  // Load all movers when modal opens
  useEffect(() => {
    if (!open) return;
    mountedRef.current = true;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    fetchIndexMovers(index, "all", controller.signal)
      .then((res) => {
        if (!mountedRef.current || controller.signal.aborted) return;
        setData(res);
      })
      .catch((e) => {
        if (!mountedRef.current || controller.signal.aborted) return;
        if (e instanceof Error && e.message === "MOVERS_UNAVAILABLE") {
          setError("unavailable");
        } else {
          setError(e instanceof Error ? e.message : "Failed to load movers");
        }
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, [open, index]);

  // Derive rows for current tab
  const rows = useMemo(() => {
    if (!data) return [];
    let source: IndexMoverRow[];
    if (tab === "gainers") source = data.gainers;
    else if (tab === "losers") source = data.losers;
    else source = [...data.gainers, ...data.losers].sort((a, b) => b.change_pct - a.change_pct);

    return source.map((r, i) => ({
      ...r,
      rank: i + 1,
      absChange: Math.abs(r.change_pct),
    }));
  }, [data, tab]);

  // Stale badge
  const isStale = data?.stale === true;

  return (
    <PanelModal
      open={open}
      title={`MOVERS · ${index} ${index === "NIFTY" ? "50" : "30"}`}
      onClose={onClose}
      maxWidth={720}
      autoHeight
      maxHeight="75vh"
      actions={
        <div className="flex items-center gap-1">
          <SegmentedControl
            value={tab}
            onChange={setTab}
            data={TABS}
            size="xs"
            className="min-w-0"
          />
          {isStale && (
            <Tooltip label="Data is stale — quotes may be delayed">
              <span
                className="inline-flex items-center gap-1 px-[2px] py-[1px] rounded-sm text-[10px] font-bold tracking-[0.05em] whitespace-nowrap"
                style={{
                  border: `1px solid ${palette.WARNING}`,
                  color: palette.WARNING,
                }}
              >
                STALE
              </span>
            </Tooltip>
          )}
        </div>
      }
    >
      {loading && !data && (
        <div
          className="flex items-center justify-center min-h-[120px] text-fin-text-muted"
        >
          <Loader size="xs" color={palette.PRIMARY} />
          <Text span size="xs" c="dimmed" style={{ marginLeft: 8 }}>
            loading movers…
          </Text>
        </div>
      )}

      {error && !data && (
        <div
          className="flex items-center justify-center min-h-[120px] gap-2 flex-wrap"
        >
          <Text span size="xs" c="error" fw={700}>
            unavailable
          </Text>
          <Button size="sm" variant="subtle" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      )}

      {data && rows.length === 0 && (
        <div className="flex items-center justify-center min-h-[120px] text-fin-text-muted">
          <Text span size="xs" c="dimmed">
            No movers data
          </Text>
        </div>
      )}

      {data && rows.length > 0 && (
        <div className="min-w-0">
          <MoversTable rows={rows} index={index} />
        </div>
      )}

      {/* Footer meta */}
      {data && (
        <div
          className="flex items-center justify-between mt-2 pt-1 border-t border-fin-border font-mono text-[10px] text-fin-text-muted"
        >
          <Text span size="xs" c="dimmed">
            Source: {data.source}
          </Text>
          <Text span size="xs" c="dimmed">
            As of: {new Date(data.as_of).toLocaleTimeString("en-IN", {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              timeZone: "Asia/Kolkata",
            })}
          </Text>
        </div>
      )}
    </PanelModal>
  );
});

IndexMoversModal.displayName = "IndexMoversModal";
