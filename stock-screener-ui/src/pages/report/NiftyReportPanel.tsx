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
    .slice(0, 2);
  const topPuts = [...report.walls.puts]
    .sort((a, b) => b.oi - a.oi)
    .slice(0, 2);
  for (const wall of topCalls) {
    lines.push({
      yAxis: wall.strike,
      lineStyle: { color: palette.NEGATIVE, type: "dashed", width: 1 },
      label: { position: "insideEndTop", formatter: `CW ${wall.strike}` },
    });
  }
  for (const wall of topPuts) {
    lines.push({
      yAxis: wall.strike,
      lineStyle: { color: palette.POSITIVE, type: "dashed", width: 1 },
      label: { position: "insideEndTop", formatter: `PW ${wall.strike}` },
    });
  }
  if (Number.isFinite(report.maxPain) && report.maxPain > 0) {
    lines.push({
      yAxis: report.maxPain,
      lineStyle: { color: palette.PRIMARY, type: "solid", width: 2 },
      label: { position: "insideEndTop", formatter: `MP ${report.maxPain}` },
    });
  }
  return lines;
}

/** Overnight levels derived from the live chain — no static copy. */
export function buildOvernightLevels(report: NiftyReport): {
  resistance: { strike: number; pct: number }[];
  support: { strike: number; pct: number }[];
  painPull: { dir: string; pct: number };
  pcrVerdict: string;
} {
  const pct = (s: number) =>
    report.spot > 0 ? ((s - report.spot) / report.spot) * 100 : 0;
  const resistance = [...report.walls.calls]
    .map((w) => w.strike)
    .filter((s) => s > report.spot)
    .sort((a, b) => a - b)
    .slice(0, 2)
    .map((strike) => ({ strike, pct: pct(strike) }));
  const support = [...report.walls.puts]
    .map((w) => w.strike)
    .filter((s) => s < report.spot)
    .sort((a, b) => b - a)
    .slice(0, 2)
    .map((strike) => ({ strike, pct: pct(strike) }));
  const painPct = pct(report.maxPain);
  const painPull = {
    dir: painPct > 0.05 ? "up" : painPct < -0.05 ? "down" : "flat",
    pct: painPct,
  };
  const pcrVerdict =
    report.pcrOi < 0.7
      ? `Bearish (PCR-OI ${report.pcrOi.toFixed(2)} — call writers in control)`
      : report.pcrOi > 1.0
        ? `Bullish (PCR-OI ${report.pcrOi.toFixed(2)} — put writers in control)`
        : `Neutral (PCR-OI ${report.pcrOi.toFixed(2)})`;
  return { resistance, support, painPull, pcrVerdict };
}

function sentimentBadge(sentiment: string, side: "ce" | "pe") {
  const code = sentiment.trim().toUpperCase();
  const label = SENTIMENT_NAMES[code] ?? sentiment;
  // Same buildup code means opposite things per side:
  // calls rise on buying (LB/SC bullish), puts rise on fear (LB bearish).
  const bullish =
    side === "ce" ? code === "LB" || code === "SC" : code === "SB" || code === "SC";
  const tone = code === "NEUTRAL" || !SENTIMENT_NAMES[code] ? palette.TEXT_MUTED : bullish ? palette.POSITIVE : palette.NEGATIVE;
  return (
    <Box
      component="span"
      sx={{
        display: "inline-block",
        border: "1px solid",
        borderColor: tone,
        borderRadius: 999,
        px: 1,
        py: 0.25,
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        verticalAlign: "middle",
      }}
    >
      <Text size="xs" fw={600} c={tone} span truncate>
        {label}
      </Text>
    </Box>
  );
}

/** Numeric cell with tabular figures + ellipsis so 1440px needs no h-scroll. */
function tabularCell(value: string, tone?: "success" | "error") {
  return (
    <Box
      component="span"
      sx={{
        display: "block",
        overflow: "hidden",
        textOverflow: "ellipsis",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Text size="xs" span c={tone ?? "default"} fw={tone ? 600 : 400}>
        {value}
      </Text>
    </Box>
  );
}

const SENTIMENT_NAMES: Record<string, string> = {
  LB: "Long Buildup",
  SB: "Short Buildup",
  SC: "Short Cover",
  LU: "Long Unwind",
};

function signedTone(v: number): "success" | "error" | undefined {
  if (v > 0) return "success";
  if (v < 0) return "error";
  return undefined;
}

export const niftyOiColumns: ColumnDef<NiftyStrike>[] = [
  {
    header: "CE Chg%",
    accessorKey: "ce.priceChange",
    accessorFn: (row) => row.ce.priceChange,
    size: 84,
    meta: { align: "right" },
    cell: (info) => {
      const v = Number(info.getValue());
      return tabularCell(v.toFixed(2), signedTone(v));
    },
  },
  {
    header: "CE OI Chg",
    accessorKey: "ce.oiChange",
    accessorFn: (row) => row.ce.oiChange,
    size: 110,
    meta: { align: "right" },
    cell: (info) => {
      const v = Number(info.getValue());
      return tabularCell(v.toLocaleString("en-IN"), signedTone(v));
    },
  },
  {
    header: "CE Signal",
    accessorKey: "ce.sentiment",
    accessorFn: (row) => row.ce.sentiment,
    size: 112,
    meta: { align: "center" },
    cell: (info) => sentimentBadge(String(info.getValue() ?? ""), "ce"),
  },
  {
    header: "Strike",
    accessorKey: "strike",
    size: 88,
    meta: { align: "right" },
    cell: (info) => (
      <Box
        component="span"
        sx={{
          display: "block",
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <Text size="xs" span fw={700}>
          {Number(info.getValue()).toLocaleString("en-IN")}
        </Text>
      </Box>
    ),
  },
  {
    header: "PE Signal",
    accessorKey: "pe.sentiment",
    accessorFn: (row) => row.pe.sentiment,
    size: 112,
    meta: { align: "center" },
    cell: (info) => sentimentBadge(String(info.getValue() ?? ""), "pe"),
  },
  {
    header: "PE OI Chg",
    accessorKey: "pe.oiChange",
    accessorFn: (row) => row.pe.oiChange,
    size: 110,
    meta: { align: "right" },
    cell: (info) => {
      const v = Number(info.getValue());
      return tabularCell(v.toLocaleString("en-IN"), signedTone(v));
    },
  },
  {
    header: "PE Chg%",
    accessorKey: "pe.priceChange",
    accessorFn: (row) => row.pe.priceChange,
    size: 84,
    meta: { align: "right" },
    cell: (info) => {
      const v = Number(info.getValue());
      return tabularCell(v.toFixed(2), signedTone(v));
    },
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

  const levels = useMemo(
    () => (report ? buildOvernightLevels(report) : null),
    [report],
  );

  return (
    <Box
      data-testid="nifty-report-panel"
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        p: 2,
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        overflowX: "hidden",
      }}
    >
      <CompactPanel>
        <Box
          data-testid="nifty-toolbar"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            flexWrap: "nowrap",
            width: "100%",
            maxWidth: "100%",
            minWidth: 0,
            overflowX: "auto",
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
            sx={{ display: "flex", width: "100%", minWidth: 0 }}
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
              <Box
                data-testid="nifty-chart-wrap"
                sx={{
                  display: "flex",
                  width: "100%",
                  maxWidth: "100%",
                  minWidth: 0,
                  minHeight: 380,
                  height: "min(62vh, 600px)",
                  overflow: "hidden",
                }}
              >
                <TradingViewChart
                  candles={report.candles}
                  markLines={markLines}
                />
              </Box>
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
                    <Text size="xs" c="dimmed" lh={1.4}>
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

          <CompactPanel title="Tomorrow's levels" testId="nifty-tomorrow-panel">
            {levels && (
            <Box data-testid="nifty-levels-row">
              <CompactStatGrid>
                {levels.resistance.map((r, i) => (
                  <CompactStat
                    key={`r-${r.strike}`}
                    data-testid={`nifty-level-r${i + 1}`}
                    label={i === 0 ? "Resistance R1" : "Resistance R2"}
                    value={`${r.strike.toLocaleString("en-IN")} (${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(2)}%)`}
                  />
                ))}
                <CompactStat
                  data-testid="nifty-level-pain"
                  label={`Max-pain pull ${levels.painPull.dir}`}
                  value={`${report.maxPain.toLocaleString("en-IN")} (${levels.painPull.pct >= 0 ? "+" : ""}${levels.painPull.pct.toFixed(2)}%)`}
                />
                {levels.support.map((s, i) => (
                  <CompactStat
                    key={`s-${s.strike}`}
                    data-testid={`nifty-level-s${i + 1}`}
                    label={i === 0 ? "Support S1" : "Support S2"}
                    value={`${s.strike.toLocaleString("en-IN")} (${s.pct.toFixed(2)}%)`}
                  />
                ))}
              </CompactStatGrid>
              <Text data-testid="nifty-levels-verdict" size="sm" c="dimmed">
                {levels.pcrVerdict}. Gap above{" "}
                {levels.resistance[0]?.strike.toLocaleString("en-IN") ?? "—"}{" "}
                squeezes call writers; acceptance below{" "}
                {levels.support[0]?.strike.toLocaleString("en-IN") ?? "—"}{" "}
                opens the next put wall.
              </Text>
            </Box>
            )}
          </CompactPanel>

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
