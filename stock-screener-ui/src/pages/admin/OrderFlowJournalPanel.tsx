import { createSignal, createMemo, onMount, Show, type JSX } from "solid-js";
import { usePolling } from "@/hooks/usePolling";
import type { TableColumnDef } from "../../components/common/TanStackTable";
import { Alert, Badge, Box, Button, Group, Loader, Select, Stack, Text } from "@/ui";
import { Icon } from "../../components/common/Icons";
import { useAuth } from "../../components/auth/AuthProvider2";
import { CompactPanel, CompactStat, CompactStatGrid } from "../../components/common/compact";
import { TanStackTable } from "../../components/common/TanStackTable";
import type { OrderFlowJournalRow, OrderFlowJournalSummary } from "../../types/admin";

import { API_BASE } from "@/api/config";
const REFRESH_MS = 60_000;

const MONO = "font-mono tabular-nums";

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

function cell(align: "left" | "right" | "center", children: JSX.Element) {
  const justify = align === "right" ? "end" : align === "center" ? "center" : "start";
  return (
    <Box className={`flex items-center gap-2 p-2 justify-${justify}`}>
      {children}
    </Box>
  );
}

const COLUMNS: TableColumnDef<OrderFlowJournalRow>[] = [
  {
    id: "symbol",
    header: () => cell("left", "Symbol"),
    accessorKey: "symbol",
    meta: { align: "left" },
    cell: ({ row }) => (
      <Box className="flex items-center justify-start gap-2 p-2">
        <Text size="sm" fw={700}>{row.original.symbol}</Text>
      </Box>
    ),
  },
  {
    id: "broker",
    header: () => cell("left", "Broker"),
    accessorKey: "broker",
    meta: { align: "left" },
    cell: ({ row }) => {
      const key = row.original.broker;
      const badge = BROKER_BADGE[key] ?? BROKER_BADGE.unknown;
      const r = row.original;
      return (
        <Box className="flex items-center justify-start gap-2 p-2">
          <Badge color={badge.color} variant={key === "mixed" ? "filled" : "light"} size="sm"
            data-testid={`ofj-broker-${key}`}>
            {badge.label}
          </Badge>
          <Show when={r.broker_mismatch}>
            <Badge color="red" variant="filled" size="sm" data-testid="ofj-broker-mismatch">
              name says {r.named_broker}
            </Badge>
          </Show>
        </Box>
      );
    },
  },
  {
    id: "bytes",
    header: () => cell("right", "Stored"),
    accessorKey: "bytes",
    meta: { align: "right" },
    cell: ({ row }) => (
      <Box className="flex items-center justify-end gap-2 p-2">
        <Text size="sm" class={MONO}>{formatBytes(row.original.bytes)}</Text>
      </Box>
    ),
  },
  {
    id: "records",
    header: () => cell("right", "Records"),
    accessorKey: "records",
    meta: { align: "right" },
    cell: ({ row }) => (
      <Box className="flex items-center justify-end gap-2 p-2">
        <Text size="sm" class={MONO}>{row.original.records.toLocaleString()}</Text>
      </Box>
    ),
  },
  {
    id: "coverage",
    header: () => cell("right", "Coverage"),
    accessorKey: "coverage_pct",
    meta: { align: "right" },
    cell: ({ row }) => {
      const pct = row.original.coverage_pct;
      return (
        <Box className="flex items-center justify-end gap-2 p-2">
          <Text size="sm" fw={700} c={coverageTone(pct)} class={MONO} data-testid="ofj-coverage">
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
    cell: ({ row }) => (
      <Box className="flex items-center justify-start gap-2 p-2">
        <Text size="sm" c="dimmed">{describeGap(row.original)}</Text>
      </Box>
    ),
  },
];

export function OrderFlowJournalPanel() {
  const { fetchWithAuth } = useAuth();
  const [summary, setSummary] = createSignal<OrderFlowJournalSummary | null>(null);
  const [day, setDay] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  let loaded = false;

  const load = async (targetDay: string | null) => {
    if (!loaded) setLoading(true);
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
      if (!targetDay || day() === null) setDay(data.day);
      loaded = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    void load(null);
  });

  usePolling(() => void load(day()), REFRESH_MS, { skipIfRunning: false });

  const rows = createMemo(() => summary()?.rows ?? []);

  return (
    <Show
      when={!loading() || summary()}
      fallback={
        <Group justify="center" p={16}>
          <Loader size="sm" />
        </Group>
      }
    >
      <Stack gap={8} data-testid="orderflow-journal-panel">
        <Show when={error()}>
          <Alert color="error" variant="light" data-testid="ofj-error">{error()}</Alert>
        </Show>

        <Show when={summary()}>
          {(s) => (
            <>
              <CompactStatGrid>
                <CompactStat label="Day" value={s().day} />
                <CompactStat
                  label="Session coverage"
                  value={formatCoverage(s().overall_coverage_pct)}
                  tone={coverageTone(s().overall_coverage_pct) === "text.secondary" ? "text.primary" : coverageTone(s().overall_coverage_pct)}
                  hint={`${s().session_start}–${s().session_close} · ${s().session_minutes} min`}
                />
                <CompactStat label="Stored" value={formatBytes(s().total_bytes)} hint={`${s().total_records.toLocaleString()} records`} />
                <CompactStat
                  label="Symbols"
                  value={String(rows().length)}
                  hint={s().broker_available ? "journal enabled" : "journal disabled"}
                />
              </CompactStatGrid>

              <Group gap={8} align="center" wrap="wrap">
                <Box className="w-[200px]">
                  <Select
                    size="sm"
                    label="Day"
                    data={s().available_days.map((d) => ({ value: d, label: d }))}
                    value={day()}
                    onChange={(value) => {
                      setDay(value);
                      void load(value);
                    }}
                    data-testid="ofj-day-select"
                  />
                </Box>
                <Button size="sm" variant="outline" leftSection={<Icon name="refresh" size={16} />}
                  onClick={() => void load(day())} data-testid="ofj-refresh">
                  Refresh
                </Button>
                <Text size="xs" c="dimmed">
                  Coverage = share of session minutes with at least one stored record. Auto-refreshes every 60s.
                </Text>
                <Show when={s().auction_minutes > 0}>
                  <Text size="xs" c="dimmed" data-testid="ofj-cas-note">
                    Measured to <b>{s().session_close}</b> — continuous cash trading ends there
                    (NSE closing auction runs until {s().full_session_close}, so no trades print
                    in the last {s().auction_minutes} min).
                  </Text>
                </Show>
              </Group>

              <CompactPanel title={`Stored data — ${s().day}`}>
                <TanStackTable<OrderFlowJournalRow>
                  data={rows()}
                  columns={COLUMNS}
                  dataTestId="orderflow-journal-table"
                  emptyMessage="No journal data for this day"
                />
              </CompactPanel>
            </>
          )}
        </Show>
      </Stack>
    </Show>
  );
}
