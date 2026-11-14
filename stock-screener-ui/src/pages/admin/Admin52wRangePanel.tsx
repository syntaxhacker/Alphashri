import { createSignal, createMemo, Show } from "solid-js";
import { usePolling } from "@/hooks/usePolling";
import {
  Alert, Badge, Box, Button, Checkbox, Loader, Progress, Stack, Text,
} from "@/ui";
import { ToolbarRow } from "@/ui";
import { Icon } from "../../components/common/Icons";
import { useAuth } from "../../components/auth/AuthProvider2";
import { CompactPanel, CompactStat, CompactStatGrid } from "../../components/common/compact";
import type { Week52RangeAdminStatus } from "../../types/admin";

import { API_BASE } from "@/api/config";

const MONO = "font-mono tabular-nums text-[11px]";

function formatDateTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

export function Admin52wRangePanel() {
  const { fetchWithAuth } = useAuth();
  const [data, setData] = createSignal<Week52RangeAdminStatus | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [starting, setStarting] = createSignal(false);
  const [clearing, setClearing] = createSignal(false);
  const [fullRefresh, setFullRefresh] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let loaded = false;

  const fetchStatus = async () => {
    if (!loaded) setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/admin/52w-range-status`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      setData(await res.json());
      loaded = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  const startBatch = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/admin/52w-range/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skip_existing: !fullRefresh(),
          full_refresh: fullRefresh(),
          redis: true,
          limit: 0,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start");
    } finally {
      setStarting(false);
    }
  };

  const clearAction = async (clearDb: boolean) => {
    const msg = clearDb
      ? "Delete all stock_52w_range rows + Redis 52W cache + screener cache?"
      : "Delete Redis 52W cache + screener cache? DB rows stay.";
    if (!window.confirm(msg)) return;
    setClearing(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/admin/52w-range/cache?clear_db=${clearDb}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear");
    } finally {
      setClearing(false);
    }
  };

  usePolling(fetchStatus, 5000, { immediate: true, skipIfRunning: false });

  const vm = createMemo(() => {
    const d = data();
    const job = d?.job;
    const db = d?.database;
    const running = job?.status === "running";
    const stale = !running && job?.status === "idle" && job?.stale;
    const progress =
      job?.progress_pct ??
      (job?.total && job?.processed ? Math.round((100 * job.processed) / job.total) : 0);
    return { job, db, running, stale, progress, d };
  });

  return (
    <Show
      when={!loading() || data()}
      fallback={
        <Box data-testid="admin-52w-loading" className="flex items-center gap-1 p-1">
          <Loader size="xs" />
          <Text size="xs" c="dimmed">Loading 52W range status…</Text>
        </Box>
      }
    >
      <Stack gap={4} className="h-full min-h-0 overflow-auto" data-testid="admin-52w-range-panel">
        <CompactStatGrid cols={3} spacing={4}>
          <CompactStat dense label="DB rows" value={vm().db?.db_row_count ?? "—"} />
          <CompactStat
            dense
            label="Coverage"
            value={vm().db?.coverage_pct != null ? `${vm().db!.coverage_pct}%` : "—"}
            hint={`${vm().db?.db_row_count ?? 0} / ${vm().db?.expected_universe ?? "?"} EQ`}
          />
          <CompactStat dense label="Expected EQ" value={vm().db?.expected_universe ?? "—"} />
        </CompactStatGrid>

        <CompactPanel title="Batch status" flush>
          <ToolbarRow gap={4} className="px-1 py-[2px]">
            <Text size="xs" c="dimmed">Job:</Text>
            <Badge
              size="xs"
              color={vm().running ? "warning" : vm().stale ? "warning" : vm().job?.status === "completed" ? "success" : vm().job?.status === "failed" ? "error" : "secondary"}
              variant="light"
            >
              {vm().job?.status}{vm().stale ? " — stale" : ""}
            </Badge>
            <Show when={vm().job?.elapsed_sec != null && !vm().running}>
              <Text size="xs" c="dimmed" class={MONO}>{vm().job?.elapsed_sec}s</Text>
            </Show>
            <Show when={vm().job?.finished_at && !vm().running}>
              <Text size="xs" c="dimmed" class={MONO}>· {formatDateTime(vm().job!.finished_at!)}</Text>
            </Show>
          </ToolbarRow>
        </CompactPanel>

        <ToolbarRow gap={4} justify="space-between" wrap={false} data-testid="admin-52w-toolbar">
          <ToolbarRow gap={4} wrap={false}>
            <Show when={vm().running} fallback={
              <Button size="xs" leftSection={<Icon name="player-play" size={12} />} onClick={startBatch} loading={starting()} data-testid="admin-52w-run">
                Run batch
              </Button>
            }>
              <Button size="xs" leftSection={<Icon name="player-play" size={12} />} onClick={startBatch} loading={starting()} disabled data-testid="admin-52w-run">
                Run batch
              </Button>
            </Show>
            <Show when={vm().running} fallback={
              <Button size="xs" variant="filled" color="warning" leftSection={<Icon name="trash" size={12} />} onClick={() => clearAction(false)} loading={clearing()}>
                Clear cache
              </Button>
            }>
              <Button size="xs" variant="filled" color="warning" leftSection={<Icon name="trash" size={12} />} onClick={() => clearAction(false)} loading={clearing()} disabled>
                Clear cache
              </Button>
            </Show>
            <Show when={vm().running} fallback={
              <Button size="xs" variant="filled" color="error" leftSection={<Icon name="trash" size={12} />} onClick={() => clearAction(true)} loading={clearing()}>
                Clear cache + DB
              </Button>
            }>
              <Button size="xs" variant="filled" color="error" leftSection={<Icon name="trash" size={12} />} onClick={() => clearAction(true)} loading={clearing()} disabled>
                Clear cache + DB
              </Button>
            </Show>
          </ToolbarRow>
          <ToolbarRow gap={4} wrap={false}>
            <Checkbox
              label="Full refresh (~2466 EQ symbols, no skip-existing)"
              checked={fullRefresh()}
              onChange={(e) => setFullRefresh(e.currentTarget.checked)}
              data-testid="admin-52w-full-refresh"
              size="xs"
            />
            <Button size="xs" variant="light" leftSection={<Icon name="refresh" size={12} />} onClick={fetchStatus} loading={loading()} style={{ "min-height": "24px" }}>
              Refresh
            </Button>
          </ToolbarRow>
        </ToolbarRow>

        <Show when={error()}>
          <Alert color="error" data-testid="admin-52w-error">{error()}</Alert>
        </Show>

        <Show when={vm().running}>
          <CompactPanel title="Batch progress" flush>
            <Stack gap={2} className="px-1 py-[2px]">
              <ToolbarRow gap={4} justify="space-between" wrap={false}>
                <Text size="xs" fw={500}>Batch Progress</Text>
                <Text size="xs" c="dimmed" class={MONO}>
                  {vm().job?.processed ?? 0} / {vm().job?.total ?? "?"} · ok {vm().job?.ok ?? 0} · fail {vm().job?.failed ?? 0} · skip {vm().job?.skipped ?? 0}
                </Text>
              </ToolbarRow>
              <Progress value={vm().progress} size="sm" animated />
              <Show when={vm().job?.last_symbol}>
                <Text size="xs" c="dimmed" class={MONO}>Last: {vm().job?.last_symbol}</Text>
              </Show>
              <Show when={vm().job?.message}>
                <Text size="xs" c="dimmed">{vm().job?.message}</Text>
              </Show>
            </Stack>
          </CompactPanel>
        </Show>

        <Show when={!vm().running && vm().job?.status === "completed"}>
          <Alert color="success" data-testid="admin-52w-completed">
            <Text size="xs">Batch completed{vm().job?.elapsed_sec != null ? ` in ${vm().job!.elapsed_sec}s` : ""}</Text>
            <Show when={vm().job?.message}>
              <Text size="xs" c="dimmed">{vm().job?.message}</Text>
            </Show>
          </Alert>
        </Show>

        <Show when={!vm().running && vm().job?.status === "failed"}>
          <Alert color="error" data-testid="admin-52w-failed">
            <Text size="xs">Batch failed</Text>
            <Text size="xs">{String(vm().job?.error || vm().job?.message || "").slice(0, 300)}</Text>
          </Alert>
        </Show>

        <Show when={vm().db?.db_latest_updated_at}>
          <Text size="xs" c="dimmed" class={MONO} data-testid="admin-52w-latest-update">
            Latest DB update: {formatDateTime(vm().db!.db_latest_updated_at!)}
          </Text>
        </Show>
        <Show when={vm().d?.run_hint && !vm().running}>
          <Text size="xs" c="dimmed" class={MONO}>CLI: {vm().d?.run_hint}</Text>
        </Show>
      </Stack>
    </Show>
  );
}
