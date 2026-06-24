import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
  Progress,
  Stack,
  Text,
} from "@mantine/core";
import { IconPlayerPlay, IconRefresh, IconTrash } from "@tabler/icons-react";
import { useAuth } from "../../components/auth/AuthProvider2";
import { CompactPanel, CompactStat, CompactStatGrid } from "../../components/common/compact";
import type { Week52RangeAdminStatus } from "../../types/admin";
import { formatDateTime } from "./formatters";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

export function Admin52wRangePanel() {
  const { fetchWithAuth } = useAuth();
  const [data, setData] = useState<Week52RangeAdminStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [fullRefresh, setFullRefresh] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/admin/52w-range-status`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load 52W status");
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
      setError(err instanceof Error ? err.message : "Failed to start batch");
    } finally {
      setStarting(false);
    }
  };

  const clearCache = async (clearDb: boolean) => {
    const msg = clearDb
      ? "Delete all stock_52w_range rows + Redis 52W cache + screener cache? Next run can refresh all ~2466 EQ from Upstox."
      : "Delete Redis 52W cache + screener cache? DB rows stay; use Full refresh to re-fetch all EQ.";
    if (!window.confirm(msg)) return;

    setClearing(true);
    setError(null);
    try {
      const res = await fetchWithAuth(
        `${API_BASE}/api/admin/52w-range/cache?clear_db=${clearDb}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear cache");
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
    (job?.total && job?.processed
      ? Math.round((100 * job.processed) / job.total)
      : 0);

  return (
    <Stack gap="sm" data-testid="admin-52w-range-panel">
      <Text size="sm" c="dimmed">
        {data?.schedule?.description ??
          "Upstox batch fills stock_52w_range for the 52W High screener."}
      </Text>

      <Group gap="xs" wrap="wrap">
        <Button
          size="xs"
          variant="light"
          leftSection={<IconRefresh size={14} />}
          onClick={fetchStatus}
          loading={loading}
          data-testid="admin-52w-refresh"
        >
          Refresh
        </Button>
        <Button
          size="xs"
          leftSection={<IconPlayerPlay size={14} />}
          onClick={startBatch}
          loading={starting}
          disabled={running}
          data-testid="admin-52w-run"
        >
          Run batch
        </Button>
        <Button
          size="xs"
          variant="light"
          color="orange"
          leftSection={<IconTrash size={14} />}
          onClick={() => void clearCache(false)}
          loading={clearing}
          disabled={running}
          data-testid="admin-52w-clear-cache"
        >
          Clear cache
        </Button>
        <Button
          size="xs"
          variant="light"
          color="red"
          leftSection={<IconTrash size={14} />}
          onClick={() => void clearCache(true)}
          loading={clearing}
          disabled={running}
          data-testid="admin-52w-clear-db"
        >
          Clear cache + DB
        </Button>
      </Group>

      <Checkbox
        label="Full refresh (~2466 EQ symbols, no skip-existing)"
        checked={fullRefresh}
        onChange={(e) => setFullRefresh(e.currentTarget.checked)}
        data-testid="admin-52w-full-refresh"
      />

      {error && (
        <Alert color="red" title="Error">
          {error}
        </Alert>
      )}

      {loading && !data ? (
        <Group gap="xs">
          <Loader size="sm" />
          <Text size="sm">Loading 52W range status…</Text>
        </Group>
      ) : (
        <>
          <CompactStatGrid>
            <CompactStat label="DB rows" value={db?.db_row_count ?? "—"} />
            <CompactStat
              label="Coverage"
              value={db?.coverage_pct != null ? `${db.coverage_pct}%` : "—"}
            />
            <CompactStat label="Expected EQ" value={db?.expected_universe ?? "—"} />
            <CompactStat label="Job status" value={job?.status ?? "idle"} />
          </CompactStatGrid>

          {running && (
            <CompactPanel title="Batch progress" padded>
              <Stack gap="xs">
                <Progress value={progress} size="lg" animated />
                <Text size="sm">
                  {job?.processed ?? 0} / {job?.total ?? "?"} — ok {job?.ok ?? 0}, failed{" "}
                  {job?.failed ?? 0}, skipped {job?.skipped ?? 0}
                  {job?.last_symbol ? ` · last: ${job.last_symbol}` : ""}
                </Text>
                {job?.message && (
                  <Text size="xs" c="dimmed">
                    {job.message}
                  </Text>
                )}
              </Stack>
            </CompactPanel>
          )}

          {!running && job?.status === "completed" && (
            <Alert color="green" title="Last batch completed">
              {job.message}
              {job.elapsed_sec != null ? ` (${job.elapsed_sec}s)` : ""}
              {job.finished_at ? ` • ${formatDateTime(job.finished_at)}` : ""}
            </Alert>
          )}

          {!running && job?.status === "failed" && (
            <Alert color="red" title="Last batch failed">
              {job.error || job.message}
              {job.finished_at ? ` • ${formatDateTime(job.finished_at)}` : ""}
            </Alert>
          )}

          {db?.db_latest_updated_at && (
            <Text size="xs" c="dimmed" title={db.db_latest_updated_at}>
              Latest DB update: {formatDateTime(db.db_latest_updated_at)}
            </Text>
          )}

          {data?.run_hint && (
            <Text size="xs" c="dimmed">
              CLI: {data.run_hint}
            </Text>
          )}
        </>
      )}
    </Stack>
  );
}