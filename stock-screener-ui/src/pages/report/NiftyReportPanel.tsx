import { useCallback, useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import {
  Button,
  SegmentedControl,
  Select,
  Text,
  TextInput,
  Timeline,
  TimelineItem,
} from "@/ui";
import * as palette from "@/ui/palette";
import { TradingViewChart } from "@/components/chart/TradingViewChart";
import { TanStackTable } from "@/components/common/TanStackTable";
import { CompactPanel, CompactStat, CompactStatGrid } from "@/components/common/compact";
import { EmptyCompact, ErrorAlert, InlineLoader } from "@/components/common/states";
import type { ColumnDef } from "@tanstack/react-table";
import type { MarkLineData } from "@/utils/chart/types";
import type {
  NiftyReport,
  NiftyReportMode,
  NiftyStrike,
} from "@/types/niftyReport";
import { fetchLiveNifty, fetchNiftyByDate, fetchNiftyExpiries, snapshotNifty } from "@/api/reportNifty";

export interface NiftyReportPanelProps {
  onOpenSymbol?: (s: string) => void;
}

function buildMarkLines(report: NiftyReport): MarkLineData[] {
  const lines: MarkLineData[] = [];
  const topCalls = [...report.walls.calls]
    .sort((a, b) => b.oi - a.oi)
    .slice(0, 3);
  const topPuts = [...report.walls.puts]
    .sort((a, b) => b.oi - a.oi)
    .slice(0, 3);
  for (const wall of topCalls) {
    lines.push({
      yAxis: wall.strike,
      lineStyle: { color: palette.NEGATIVE, type: "dashed", width: 1 },
      label: { position: "insideEndTop", formatter: `Call wall ${wall.strike}` },
    });
  }
  for (const wall of topPuts) {
    lines.push({
      yAxis: wall.strike,
      lineStyle: { color: palette.POSITIVE, type: "dashed", width: 1 },
      label: { position: "insideEndTop", formatter: `Put wall ${wall.strike}` },
    });
  }
  if (Number.isFinite(report.maxPain) && report.maxPain > 0) {
    lines.push({
      yAxis: report.maxPain,
      lineStyle: { color: palette.PRIMARY, type: "solid", width: 1 },
      label: { position: "insideEndTop", formatter: `Max pain ${report.maxPain}` },
    });
  }
  return lines;
}

function sentimentBadge(sentiment: string) {
  const tone =
    sentiment.toLowerCase().includes("bull")
      ? palette.POSITIVE
      : sentiment.toLowerCase().includes("bear")
        ? palette.NEGATIVE
        : palette.TEXT_MUTED;
  return (
    <Text size="xs" fw={600} ta="center" c={tone}>
      {sentiment}
    </Text>
  );
}

export const niftyOiColumns: ColumnDef<NiftyStrike>[] = [
  {
    header: "CE Chg%",
    accessorKey: "ce.priceChange",
    accessorFn: (row) => row.ce.priceChange,
    meta: { align: "right" },
    cell: (info) => Number(info.getValue()).toFixed(2),
  },
  {
    header: "CE OI Chg",
    accessorKey: "ce.oiChange",
    accessorFn: (row) => row.ce.oiChange,
    meta: { align: "right" },
    cell: (info) => Number(info.getValue()).toLocaleString("en-IN"),
  },
  {
    header: "CE Signal",
    accessorKey: "ce.sentiment",
    accessorFn: (row) => row.ce.sentiment,
    meta: { align: "center" },
    cell: (info) => sentimentBadge(String(info.getValue() ?? "")),
  },
  {
    header: "Strike",
    accessorKey: "strike",
    meta: { align: "right" },
  },
  {
    header: "PE Signal",
    accessorKey: "pe.sentiment",
    accessorFn: (row) => row.pe.sentiment,
    meta: { align: "center" },
    cell: (info) => sentimentBadge(String(info.getValue() ?? "")),
  },
  {
    header: "PE OI Chg",
    accessorKey: "pe.oiChange",
    accessorFn: (row) => row.pe.oiChange,
    meta: { align: "right" },
    cell: (info) => Number(info.getValue()).toLocaleString("en-IN"),
  },
  {
    header: "PE Chg%",
    accessorKey: "pe.priceChange",
    accessorFn: (row) => row.pe.priceChange,
    meta: { align: "right" },
    cell: (info) => Number(info.getValue()).toFixed(2),
  },
];

export function NiftyReportPanel({ onOpenSymbol }: NiftyReportPanelProps) {
  const [mode, setMode] = useState<NiftyReportMode>("live");
  const [expiry, setExpiry] = useState<string>("");
  const [expiryOptions, setExpiryOptions] = useState<string[]>([]);
  const [date, setDate] = useState<string>("");
  const [report, setReport] = useState<NiftyReport | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshotting, setSnapshotting] = useState<boolean>(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data =
        mode === "live"
          ? await fetchLiveNifty(expiry)
          : await fetchNiftyByDate(date);
      setReport(data);
    } catch (e) {
      setReport(null);
      setError(e instanceof Error ? e.message : "Failed to load Nifty report");
    } finally {
      setLoading(false);
    }
  }, [mode, expiry, date]);

  useEffect(() => {
    let active = true;
    fetchNiftyExpiries()
      .then((list) => {
        if (active) setExpiryOptions(list.map((e) => e.date));
      })
      .catch(() => {
        /* non-fatal: picker falls back to nearest */
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (mode === "live" || (mode === "eod" && date)) {
      void load();
    }
  }, [mode, load, date]);

  const handleSnapshot = useCallback(async () => {
    setSnapshotting(true);
    setError(null);
    try {
      const data = await snapshotNifty(
        mode === "eod" ? date || undefined : undefined,
        expiry,
      );
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Snapshot failed");
    } finally {
      setSnapshotting(false);
    }
  }, [mode, date, expiry]);

  const markLines = useMemo(
    () => (report ? buildMarkLines(report) : []),
    [report],
  );

  /** Readability: full chain is noise — show the ATM window only. */
  const visibleStrikes = useMemo(
    () =>
      report
        ? report.strikes.filter((s) => Math.abs(s.strike - report.spot) <= 750)
        : [],
    [report],
  );

  return (
    <Box
      data-testid="nifty-report-panel"
      sx={{ display: "flex", flexDirection: "column", gap: 2, p: 2 }}
    >
      <CompactPanel>
        <Box
          data-testid="nifty-toolbar"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            flexWrap: "wrap",
          }}
        >
          <SegmentedControl
            data-testid="nifty-mode-toggle"
            value={mode}
            onChange={(v) => setMode(v as NiftyReportMode)}
            data={[
              { value: "live", label: "Live" },
              { value: "eod", label: "EOD" },
            ]}
            size="sm"
          />
          <Select
            data-testid="nifty-expiry-select"
            value={expiry}
            onChange={(v) => setExpiry(v ?? "")}
            data={[
              { value: "", label: "Nearest expiry" },
              ...expiryOptions.map((d) => ({ value: d, label: d })),
            ]}
            size="sm"
            w={180}
          />
          {mode === "eod" && (
            <TextInput
              data-testid="nifty-date-input"
              type="date"
              value={date}
              onChange={setDate}
              size="sm"
              w={160}
            />
          )}
          <Button
            data-testid="nifty-refresh-button"
            size="sm"
            onClick={() => void load()}
            disabled={loading || (mode === "eod" && !date)}
          >
            Refresh
          </Button>
          <Button
            data-testid="nifty-snapshot-button"
            size="sm"
            variant="outline"
            onClick={() => void handleSnapshot()}
            disabled={
              snapshotting || loading || (mode === "eod" && !date)
            }
          >
            Snapshot
          </Button>
        </Box>
      </CompactPanel>

      {loading && <InlineLoader data-testid="nifty-loading" />}

      {error && !loading && (
        <ErrorAlert
          data-testid="nifty-error"
          title="Nifty report failed"
          message={error}
          withRetry
          onRetry={() => void load()}
        />
      )}

      {!loading && !error && !report && (
        <EmptyCompact
          data-testid="nifty-empty"
          title="No Nifty data"
          description={
            mode === "eod" && !date
              ? "Pick a date to load the EOD report."
              : "Refresh to load the latest Nifty option-chain report."
          }
        />
      )}

      {!loading && !error && report && (
        <>
          <Box
            data-testid="nifty-stat-strip"
            sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}
          >
            <CompactStatGrid>
              <CompactStat
                data-testid="nifty-stat-spot"
                label="Spot"
                value={report.spot.toLocaleString("en-IN")}
              />
              <CompactStat
                data-testid="nifty-stat-pcr-oi"
                label="PCR (OI)"
                value={report.pcrOi.toFixed(2)}
              />
              <CompactStat
                data-testid="nifty-stat-pcr-vol"
                label="PCR (Vol)"
                value={report.pcrVol.toFixed(2)}
              />
              <CompactStat
                data-testid="nifty-stat-max-pain"
                label="Max Pain"
                value={report.maxPain.toLocaleString("en-IN")}
              />
            </CompactStatGrid>
          </Box>

          <CompactPanel title="Nifty chart" testId="nifty-chart-panel">
            {report.candles && report.candles.length > 0 ? (
              <TradingViewChart
                candles={report.candles}
                markLines={markLines}
                height={320}
              />
            ) : (
              <EmptyCompact
                data-testid="nifty-chart-empty"
                title="No intraday candles"
                description="Showing option-chain levels only."
              />
            )}
          </CompactPanel>

          {report.timeline.length > 0 && (
            <CompactPanel title="Session timeline" testId="nifty-timeline-panel">
              <Timeline data-testid="nifty-timeline" active={report.timeline.length - 1}>
                {report.timeline.map((event, idx) => (
                  <TimelineItem
                    key={`${event.time}-${idx}`}
                    data-testid={`nifty-timeline-item-${idx}`}
                    title={`${event.time} — ${event.title}`}
                  >
                    <Text size="sm" c="dimmed">
                      {event.detail}
                    </Text>
                  </TimelineItem>
                ))}
              </Timeline>
            </CompactPanel>
          )}

          <CompactPanel title="Option-chain OI (±750 ATM)" testId="nifty-oi-panel">
            <TanStackTable<NiftyStrike>
              data={visibleStrikes}
              columns={niftyOiColumns}
              dataTestId="nifty-oi-table"
              emptyMessage="No strikes for this expiry"
            />
          </CompactPanel>

          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
            <CompactPanel title="BTST note" testId="nifty-btst-note">
              <Text size="sm" c="dimmed">
                BTST setups historically print 43-52% on roughly half the
                signals, versus 25-36% for same-day intraday exits. Prefer
                carrying only A-grade wall-break structures overnight.
              </Text>
            </CompactPanel>
            <CompactPanel title="Model note" testId="nifty-model-note">
              <Text size="sm" c="dimmed">
                CE pricing model tracks within ~2% of market; PE shows a
                persistent skew premium into event expiries. Fade extreme PCR
                prints back toward the max-pain magnet.
              </Text>
            </CompactPanel>
          </Box>

          {onOpenSymbol && (
            <Button
              data-testid="nifty-open-symbol"
              size="sm"
              variant="subtle"
              onClick={() => onOpenSymbol("NIFTY")}
            >
              Open NIFTY chart
            </Button>
          )}
        </>
      )}
    </Box>
  );
}
