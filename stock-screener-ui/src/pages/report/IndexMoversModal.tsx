import React, { memo, useState, useEffect, useMemo, useRef } from "react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { PanelModal } from "@/components/common/PanelModal";
import { TanStackTable } from "@/components/common/TanStackTable";
import * as palette from "@/ui/palette";
import { Text, SegmentedControl, Button } from "@/ui";
import Tooltip from "@mui/material/Tooltip";
import Box from "@mui/material/Box";
import { formatNumberIN } from "@/utils/ui-helpers";
import {
  REPORT_FONT,
  REPORT_PAD,
  REPORT_RADIUS,
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
        <Box sx={{ display: "flex", gap: 1 }}>
          <SegmentedControl
            value={tab}
            onChange={setTab}
            data={TABS}
            size="xs"
            sx={{ minWidth: 0 }}
          />
          {isStale && (
            <Tooltip title="Data is stale — quotes may be delayed">
              <Box
                component="span"
                sx={{
                  display: "inline-flex",
                  alignItems: "center",
                  px: REPORT_PAD.xs,
                  py: "1px",
                  border: `1px solid ${palette.WARNING}`,
                  borderRadius: REPORT_RADIUS.sm,
                  color: palette.WARNING,
                  fontSize: REPORT_FONT.micro,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                }}
              >
                STALE
              </Box>
            </Tooltip>
          )}
        </Box>
      }
    >
      {loading && !data && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 120,
            color: palette.TEXT_MUTED,
          }}
        >
          <Box
            sx={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              border: `2px solid ${palette.TEXT_MUTED}`,
              borderTopColor: palette.PRIMARY,
              animation: "spin 0.8s linear infinite",
              "@keyframes spin": { to: { transform: "rotate(360deg)" } },
            }}
          />
          <Text span size="xs" c="dimmed" sx={{ ml: 2 }}>
            loading movers…
          </Text>
        </Box>
      )}

      {error && !data && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 120,
            gap: REPORT_PAD.md,
            flexWrap: "wrap",
          }}
        >
          <Text span size="xs" c="error" fw={700}>
            unavailable
          </Text>
          <Button size="sm" variant="subtle" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </Box>
      )}

      {data && rows.length === 0 && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 120,
            color: palette.TEXT_MUTED,
          }}
        >
          <Text span size="xs" c="dimmed">
            No movers data
          </Text>
        </Box>
      )}

      {data && rows.length > 0 && (
        <Box sx={{ minWidth: 0 }}>
          <MoversTable rows={rows} index={index} />
        </Box>
      )}

      {/* Footer meta */}
      {data && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            mt: REPORT_PAD.md,
            pt: REPORT_PAD.sm,
            borderTop: `1px solid ${palette.TERM_BORDER}`,
            fontSize: REPORT_FONT.micro,
            color: palette.TEXT_MUTED,
            fontFamily: palette.MONO,
          }}
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
        </Box>
      )}
    </PanelModal>
  );
});

IndexMoversModal.displayName = "IndexMoversModal";