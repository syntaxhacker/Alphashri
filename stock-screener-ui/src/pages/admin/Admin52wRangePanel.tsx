import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert, Badge, Button, Checkbox, Group, Loader, Paper, Progress, Stack, Text,
} from "@/ui";
import { ToolbarRow } from "@/ui";
import { IconPlayerPlay, IconRefresh, IconTrash } from "@tabler/icons-react";
import { useAuth } from "../../components/auth/AuthProvider2";
import { CompactPanel, CompactStat, CompactStatGrid } from "../../components/common/compact";
import type { Week52RangeAdminStatus } from "../../types/admin";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

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
  const [data, setData] = useState<Week52RangeAdminStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [fullRefresh, setFullRefresh] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    if (!loadedRef.current) setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/admin/52w-range-status`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      setData(await res.json());
      loadedRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  const startBatch = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/admin/52w-range/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skip_existing: !fullRefresh,
          full_refresh: fullRefresh,
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

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 5000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const job = data?.job;
  const db = data?.database;
  const running = job?.status === "running";
  const stale = !running && job?.status === "idle" && job?.stale;
  const progress =
    job?.progress_pct ??
    (job?.total && job?.processed ? Math.round((100 * job.processed) / job.total) : 0);

  if (loading && !data) {
    return (
      <Paper p="sm" radius="sm" data-testid="admin-52w-loading">
        <Group gap="sm" justify="center" py="sm">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">Loading 52W range status…</Text>
        </Group>
      </Paper>
    );
  }

  return (
    <Stack gap="sm" data-testid="admin-52w-range-panel">
      <CompactStatGrid>
        <CompactStat label="DB rows" value={db?.db_row_count ?? "—"} />
        <CompactStat
          label="Coverage"
          value={db?.coverage_pct != null ? `${db.coverage_pct}%` : "—"}
          hint={`${db?.db_row_count ?? 0} / ${db?.expected_universe ?? "?"} EQ`}
        />
        <CompactStat label="Expected EQ" value={db?.expected_universe ?? "—"} />
      </CompactStatGrid>

      <CompactPanel title="Batch status">
        <Group gap="xs" align="center" wrap="wrap">
          <Text size="xs" c="dimmed">Job:</Text>
          <Badge
            size="sm"
            color={running ? "warning" : stale ? "warning" : job?.status === "completed" ? "success" : job?.status === "failed" ? "error" : "secondary"}
            variant="light"
          >
            {job?.status}{stale ? " — stale" : ""}
          </Badge>
          {job?.elapsed_sec != null && !running && <Text size="xs" c="dimmed">{job.elapsed_sec}s</Text>}
          {job?.finished_at && !running && <Text size="xs" c="dimmed">· {formatDateTime(job.finished_at)}</Text>}
        </Group>
      </CompactPanel>

      <ToolbarRow gap={8} justify="space-between" wrap data-testid="admin-52w-toolbar">
        <Group gap="xs">
          <Button size="sm" leftSection={<IconPlayerPlay size={14} />} onClick={startBatch} loading={starting} disabled={running} data-testid="admin-52w-run">
            Run batch
          </Button>
          <Button size="sm" variant="filled" color="warning" leftSection={<IconTrash size={14} />} onClick={() => clearAction(false)} loading={clearing} disabled={running}>
            Clear cache
          </Button>
          <Button size="sm" variant="filled" color="error" leftSection={<IconTrash size={14} />} onClick={() => clearAction(true)} loading={clearing} disabled={running}>
            Clear cache + DB
          </Button>
        </Group>
        <Group gap="xs" align="center">
          <Checkbox
            label="Full refresh (~2466 EQ symbols, no skip-existing)"
            checked={fullRefresh}
            onChange={(e) => setFullRefresh(e.currentTarget.checked)}
            data-testid="admin-52w-full-refresh"
            size="xs"
          />
          <Button size="xs" variant="light" leftSection={<IconRefresh size={12} />} onClick={fetchStatus} loading={loading}>
            Refresh
          </Button>
        </Group>
      </ToolbarRow>

      {error && <Alert color="error">{error}</Alert>}

      {running && (
        <CompactPanel title="Batch progress">
          <Stack gap={4}>
            <Group justify="space-between">
              <Text size="sm" fw={500}>Batch Progress</Text>
              <Text size="xs" c="dimmed">
                {job?.processed ?? 0} / {job?.total ?? "?"} · ok {job?.ok ?? 0} · fail {job?.failed ?? 0} · skip {job?.skipped ?? 0}
              </Text>
            </Group>
            <Progress value={progress} size="md" animated />
            {job?.last_symbol && <Text size="xs" c="dimmed">Last: {job.last_symbol}</Text>}
            {job?.message && <Text size="xs" c="dimmed">{job.message}</Text>}
          </Stack>
        </CompactPanel>
      )}

      {!running && job?.status === "completed" && (
        <Alert color="success">
          <Text size="sm">Batch completed{job.elapsed_sec != null ? ` in ${job.elapsed_sec}s` : ""}</Text>
          {job.message && <Text size="xs" c="dimmed">{job.message}</Text>}
        </Alert>
      )}

      {!running && job?.status === "failed" && (
        <Alert color="error">
          <Text size="sm">Batch failed</Text>
          <Text size="xs">{((job.error || job.message || "") as string).slice(0, 300)}</Text>
        </Alert>
      )}

      {db?.db_latest_updated_at && (
        <Text size="xs" c="dimmed" data-testid="admin-52w-latest-update">
          Latest DB update: {formatDateTime(db.db_latest_updated_at)}
        </Text>
      )}
      {data?.run_hint && !running && (
        <Text size="xs" c="dimmed">CLI: {data.run_hint}</Text>
      )}
    </Stack>
  );
}
