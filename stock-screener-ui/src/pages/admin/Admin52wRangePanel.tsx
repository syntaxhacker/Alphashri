import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert, Button, Checkbox, Group, Loader, Paper, Progress, Stack, Text, Badge,
} from "@/ui";
import { IconPlayerPlay, IconRefresh, IconTrash } from "@tabler/icons-react";
import { useAuth } from "../../components/auth/AuthProvider2";
import { CompactPanel } from "../../components/common/compact";
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
  const progress =
    job?.progress_pct ??
    (job?.total && job?.processed ? Math.round((100 * job.processed) / job.total) : 0);

  return (
    <Stack gap="sm" data-testid="admin-52w-range-panel">
      {/* stats row + job status badge */}
      <Paper withBorder p="sm" radius="sm">
        {loading && !data ? (
          <Group gap="sm" justify="center" py="sm">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">Loading 52W range status...</Text>
          </Group>
        ) : (
          <Stack gap="sm">
            <Group gap="xl" wrap="wrap" justify="center">
              <Stack gap={0} align="center">
                <Text fw={700} size="xl">{db?.db_row_count ?? "—"}</Text>
                <Text size="xs" c="dimmed">DB rows</Text>
              </Stack>
              <Stack gap={0} align="center">
                <Text fw={700} size="xl">{db?.coverage_pct != null ? `${db.coverage_pct}%` : "—"}</Text>
                <Text size="xs" c="dimmed">Coverage</Text>
              </Stack>
              <Stack gap={0} align="center">
                <Text fw={700} size="xl">{db?.expected_universe ?? "—"}</Text>
                <Text size="xs" c="dimmed">Expected EQ</Text>
              </Stack>
            </Group>
            {job?.status && (
              <Group justify="center" gap="xs">
                <Text size="xs" c="dimmed">Job:</Text>
                <Badge
                  size="sm"
                  color={running ? "orange" : job.status === "completed" ? "green" : job.status === "failed" ? "red" : "gray"}
                  variant="light"
                >
                  {job.status}
                </Badge>
                {job?.elapsed_sec != null && !running && (
                  <Text size="xs" c="dimmed">{job.elapsed_sec}s</Text>
                )}
                {job?.finished_at && !running && (
                  <Text size="xs" c="dimmed">· {formatDateTime(job.finished_at)}</Text>
                )}
              </Group>
            )}
          </Stack>
        )}
      </Paper>

      {/* actions */}
      <Group gap="xs" wrap="wrap">
        <Button size="sm" leftSection={<IconPlayerPlay size={14} />} onClick={startBatch} loading={starting} disabled={running} data-testid="admin-52w-run">
          Run batch
        </Button>
        <Button size="sm" variant="light" color="orange" leftSection={<IconTrash size={14} />} onClick={() => clearAction(false)} loading={clearing} disabled={running}>
          Clear cache
        </Button>
        <Button size="sm" variant="light" color="red" leftSection={<IconTrash size={14} />} onClick={() => clearAction(true)} loading={clearing} disabled={running}>
          Clear cache + DB
        </Button>
        <Button size="compact-sm" variant="light" leftSection={<IconRefresh size={12} />} onClick={fetchStatus} loading={loading}>
          Refresh
        </Button>
      </Group>

      {/* full refresh toggle */}
      <Checkbox
        label="Full refresh (~2466 EQ symbols, no skip-existing)"
        checked={fullRefresh}
        onChange={(e) => setFullRefresh(e.currentTarget.checked)}
        data-testid="admin-52w-full-refresh"
        size="xs"
      />

      {/* error */}
      {error && <Alert color="red">{error}</Alert>}

      {/* batch progress */}
      {running && (
        <CompactPanel padded>
          <Stack gap={4}>
            <Group justify="space-between">
              <Text size="sm" fw={500}>Batch Progress</Text>
              <Text size="xs" c="dimmed">{job?.processed ?? 0} / {job?.total ?? "?"} · ok {job?.ok ?? 0} · fail {job?.failed ?? 0} · skip {job?.skipped ?? 0}</Text>
            </Group>
            <Progress value={progress} size="md" animated />
            {job?.last_symbol && <Text size="xs" c="dimmed">Last: {job.last_symbol}</Text>}
            {job?.message && <Text size="xs" c="dimmed">{job.message}</Text>}
          </Stack>
        </CompactPanel>
      )}

      {/* status alerts */}
      {!running && job?.status === "completed" && (
        <Alert color="green">
          <Text size="sm">Batch completed{job.elapsed_sec != null ? ` in ${job.elapsed_sec}s` : ""}</Text>
          {job.message && <Text size="xs" c="dimmed">{job.message}</Text>}
        </Alert>
      )}

      {!running && job?.status === "failed" && (
        <Alert color="red">
          <Text size="sm">Batch failed</Text>
          <Text size="xs">{(job.error || job.message || "").slice(0, 300)}</Text>
        </Alert>
      )}

      {/* footer info */}
      {db?.db_latest_updated_at && (
        <Text size="xs" c="dimmed">Latest DB update: {formatDateTime(db.db_latest_updated_at)}</Text>
      )}
      {data?.run_hint && !running && (
        <Text size="xs" c="dimmed">CLI: {data.run_hint}</Text>
      )}
    </Stack>
  );
}
