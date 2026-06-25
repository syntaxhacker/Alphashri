import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Loader,
  Stack,
  Text,
  Progress,
} from "@mantine/core";
import {
  IconPlayerPlay,
  IconRefresh,
  IconPlus,
} from "@tabler/icons-react";
import { useAuth } from "../../components/auth/AuthProvider2";
import { CompactPanel, CompactStat, CompactStatGrid } from "../../components/common/compact";
import type { NewsAnalysisQueueStatusResponse } from "../../types/admin";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

export function NewsQueuePanel() {
  const { fetchWithAuth } = useAuth();
  const [data, setData] = useState<NewsAnalysisQueueStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [enqueuing, setEnqueuing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/admin/news-queue/status`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load queue status");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  const enqueue = async () => {
    setEnqueuing(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/admin/news-queue/enqueue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 0, force: false }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enqueue");
    } finally {
      setEnqueuing(false);
    }
  };

  const processBatch = async () => {
    setProcessing(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/admin/news-queue/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max: 10 }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process queue");
    } finally {
      setProcessing(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 5000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const q = data?.queue;
  const needs = data?.needs_analysis;
  const running = processing || enqueuing;
  const pct = q?.total ? Math.round((100 * (q.done + q.failed)) / q.total) : 0;

  return (
    <Stack gap="sm" data-testid="admin-news-queue-panel">
      <Text size="sm" c="dimmed">
        Queue of news articles pending LLM analysis. Enqueue articles with broken or missing summaries, then process them in batches.
      </Text>

      <Group gap="xs" wrap="wrap">
        <Button
          size="xs"
          variant="light"
          leftSection={<IconRefresh size={14} />}
          onClick={fetchStatus}
          loading={loading}
        >
          Refresh
        </Button>
        <Button
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={enqueue}
          loading={enqueuing}
          disabled={running}
        >
          Enqueue broken
        </Button>
        <Button
          size="xs"
          leftSection={<IconPlayerPlay size={14} />}
          onClick={processBatch}
          loading={processing}
          disabled={running || !q?.pending}
        >
          Process 10
        </Button>
      </Group>

      {error && (
        <Alert color="red" title="Error">
          {error}
        </Alert>
      )}

      {loading && !data ? (
        <Group gap="xs">
          <Loader size="sm" />
          <Text size="sm">Loading queue status...</Text>
        </Group>
      ) : (
        <>
          <CompactStatGrid>
            <CompactStat label="Pending" value={q?.pending ?? "—"} />
            <CompactStat label="Processing" value={q?.processing ?? "—"} />
            <CompactStat label="Done" value={q?.done ?? "—"} />
            <CompactStat label="Failed" value={q?.failed ?? "—"} />
            <CompactStat label="Total" value={q?.total ?? "—"} />
          </CompactStatGrid>

          {q && q.total > 0 && (
            <CompactPanel title="Progress" padded>
              <Stack gap="xs">
                <Progress value={pct} size="lg" animated={!!q.pending || !!q.processing} />
                <Text size="sm">
                  {q.done + q.failed} / {q.total} completed
                </Text>
              </Stack>
            </CompactPanel>
          )}

          <CompactStatGrid>
            <CompactStat label="Broken summaries" value={needs?.broken_summary ?? "—"} />
            <CompactStat label="Null analysis" value={needs?.null_analysis ?? "—"} />
          </CompactStatGrid>

          {data?.recent_failures?.length > 0 && (
            <CompactPanel title="Recent failures" padded>
              <Stack gap="xs">
                {data.recent_failures.map((f) => (
                  <Text key={f.queue_id} size="xs" c="dimmed">
                    article={f.article_id}: {(f.headline || "").slice(0, 60)} — {f.error?.slice(0, 100)}
                  </Text>
                ))}
              </Stack>
            </CompactPanel>
          )}
        </>
      )}
    </Stack>
  );
}
