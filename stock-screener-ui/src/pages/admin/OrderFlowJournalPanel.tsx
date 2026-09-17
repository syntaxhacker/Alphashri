import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Alert, Badge, Box, Button, Group, Loader, Select, Stack, Text } from "@/ui";
import { IconRefresh } from "@tabler/icons-react";
import { useAuth } from "../../components/auth/AuthProvider2";
import { CompactPanel, CompactStat, CompactStatGrid } from "../../components/common/compact";
import { TanStackTable } from "../../components/common/TanStackTable";
import type { OrderFlowJournalRow, OrderFlowJournalSummary } from "../../types/admin";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";
const REFRESH_MS = 60_000;

/** Broker labels, including the "mixed" case that must stand out. */
export const BROKER_BADGE: Record<string, { label: string; color: string }> = {
  fyers_tbt: { label: "Fyers TBT · 50 lv", color: "blue" },
  fyers: { label: "Fyers · 5 lv", color: "cyan" },
  upstox: { label: "Upstox · 5 lv", color: "grape" },
  mixed: { label: "MIXED — more than one feed", color: "red" },
  unknown: { label: "unknown", color: "gray" },
};

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const mb = bytes / 1048576;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export function formatCoverage(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

/** Colour a coverage figure: a half-captured session should not look fine. */
export function coverageTone(pct: number): "text.secondary" | "success" | "warning" | "error" {
  if (pct >= 95) return "success";
  if (pct >= 60) return "text.secondary";
  if (pct > 0) return "warning";
  return "error";
}

export function describeGap(row: OrderFlowJournalRow): string {
  if (!row.gaps.length) return "—";
  const worst = row.gaps[0];
  return `${worst.from} → ${worst.to} (${worst.minutes}m)`;
}

function cell(align: "left" | "right" | "center", children: React.ReactNode) {
  const justify = align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start";
  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: justify, gap: 1, p: 1 }}>
      {children}
    </Box>
  );
}

export function OrderFlowJournalPanel() {
  const { fetchWithAuth } = useAuth();
  const [summary, setSummary] = useState<OrderFlowJournalSummary | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const load = useCallback(
    async (targetDay: string | null) => {
      if (!loadedRef.current) setLoading(true);
      setError(null);
      try {
        const query = targetDay ? `?day=${encodeURIComponent(targetDay)}` : "";
        const res = await fetchWithAuth(`${API_BASE}/api/admin/orderflow-journal${query}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as OrderFlowJournalSummary;
        setSummary(data);
        if (!targetDay || day === null) setDay(data.day);
        loadedRef.current = true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    },
    [fetchWithAuth, day],
  );

  useEffect(() => {
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void load(day), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, day]);

  const rows = summary?.rows ?? [];

  const columns = useMemo<ColumnDef<OrderFlowJournalRow>[]>(
    () => [
      {
        id: "symbol",
        header: () => cell("left", "Symbol"),
        accessorKey: "symbol",
        meta: { align: "left" },
        cell: (info) => (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 1, p: 1 }}>
            <Text size="sm" fw={700}>{info.getValue<string>()}</Text>
          </Box>
        ),
      },
      {
        id: "broker",
        header: () => cell("left", "Broker"),
        accessorKey: "broker",
        meta: { align: "left" },
        cell: (info) => {
          const key = info.getValue<string>();
          const badge = BROKER_BADGE[key] ?? BROKER_BADGE.unknown;
          const row = info.row.original;
          return (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 1, p: 1 }}>
              <Badge color={badge.color} variant={key === "mixed" ? "filled" : "light"} size="sm"
                data-testid={`ofj-broker-${key}`}>
                {badge.label}
              </Badge>
              {row.broker_mismatch && (
                <Badge color="red" variant="filled" size="sm" data-testid="ofj-broker-mismatch">
                  name says {row.named_broker}
                </Badge>
              )}
            </Box>
          );
        },
      },
      {
        id: "bytes",
        header: () => cell("right", "Stored"),
        accessorKey: "bytes",
        meta: { align: "right" },
        cell: (info) => (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1, p: 1 }}>
            <Text size="sm">{formatBytes(info.getValue<number>())}</Text>
          </Box>
        ),
      },
      {
        id: "records",
        header: () => cell("right", "Records"),
        accessorKey: "records",
        meta: { align: "right" },
        cell: (info) => (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1, p: 1 }}>
            <Text size="sm">{info.getValue<number>().toLocaleString()}</Text>
          </Box>
        ),
      },
      {
        id: "coverage",
        header: () => cell("right", "Coverage"),
        accessorKey: "coverage_pct",
        meta: { align: "right" },
        cell: (info) => {
          const pct = info.getValue<number>();
          return (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1, p: 1 }}>
              <Text size="sm" fw={700} c={coverageTone(pct)} data-testid="ofj-coverage">
                {formatCoverage(pct)}
              </Text>
            </Box>
          );
        },
      },
      {
        id: "gap",
        header: () => cell("left", "Worst gap"),
        accessorFn: (row) => describeGap(row),
        meta: { align: "left" },
        cell: (info) => (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 1, p: 1 }}>
            <Text size="sm" c="dimmed">{info.getValue<string>()}</Text>
          </Box>
        ),
      },
    ],
    [],
  );

  if (loading && !summary) {
    return (
      <Group justify="center" p={16}>
        <Loader size="sm" />
      </Group>
    );
  }

  return (
    <Stack gap={8} data-testid="orderflow-journal-panel">
      {error && (
        <Alert color="error" variant="light" data-testid="ofj-error">{error}</Alert>
      )}

      {summary && (
        <>
          <CompactStatGrid>
            <CompactStat label="Day" value={summary.day} />
            <CompactStat
              label="Session coverage"
              value={formatCoverage(summary.overall_coverage_pct)}
              tone={coverageTone(summary.overall_coverage_pct) === "text.secondary" ? "text.primary" : coverageTone(summary.overall_coverage_pct)}
              hint={`${summary.session_start}–${summary.session_close} · ${summary.session_minutes} min`}
            />
            <CompactStat label="Stored" value={formatBytes(summary.total_bytes)} hint={`${summary.total_records.toLocaleString()} records`} />
            <CompactStat
              label="Symbols"
              value={String(rows.length)}
              hint={summary.broker_available ? "journal enabled" : "journal disabled"}
            />
          </CompactStatGrid>

          <Group gap={8} align="center" wrap="wrap">
            <Box sx={{ width: 200 }}>
              <Select
                size="sm"
                label="Day"
                data={summary.available_days.map((d) => ({ value: d, label: d }))}
                value={day}
                onChange={(value) => {
                  setDay(value);
                  void load(value);
                }}
                data-testid="ofj-day-select"
              />
            </Box>
            <Button size="sm" variant="outline" leftSection={<IconRefresh size={16} />}
              onClick={() => void load(day)} data-testid="ofj-refresh">
              Refresh
            </Button>
            <Text size="xs" c="dimmed">
              Coverage = share of session minutes with at least one stored record. Auto-refreshes every 60s.
            </Text>
          </Group>

          <CompactPanel title={`Stored data — ${summary.day}`}>
            <TanStackTable<OrderFlowJournalRow>
              data={rows}
              columns={columns}
              dataTestId="orderflow-journal-table"
              emptyMessage="No journal data for this day"
            />
          </CompactPanel>
        </>
      )}
    </Stack>
  );
}
