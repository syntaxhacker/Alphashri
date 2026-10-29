import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Group, Loader, Paper, Progress, Stack, Text } from "@/ui";
import { ToolbarRow } from "@/ui";
import { IconPlayerPlay, IconPlus } from "@tabler/icons-react";
import { useAuth } from "../../components/auth/AuthProvider2";
import { CompactPanel, CompactStat, CompactStatGrid } from "../../components/common/compact";
import type { NewsAnalysisQueueStatus, NewsAnalysisQueueStatusResponse } from "../../types/admin";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

interface ProcessResult {
  status?: string;
  processed?: number;
  failed?: number;
  article_id?: number;
  headline?: string;
  summary?: string;
  sentiment?: string;
  impact_score?: number;
  error?: string;
  message?: string;
}

export function NewsQueuePanel() {
  const { fetchWithAuth } = useAuth();
  const [data, setData] = useState<NewsAnalysisQueueStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    if (!loadedRef.current) setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/admin/news-queue/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      loadedRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  const doAction = async (action: string, body: object) => {
    setActionLoading(action);
    setError(null);
    setResult(null);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/admin/news-queue/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.detail || `HTTP ${res.status}`);
      }
      const r = await res.json();
      setResult(r);
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 5000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const q: NewsAnalysisQueueStatus = data?.queue ?? {
    pending: 0,
    processing: 0,
    done: 0,
    failed: 0,
    total: 0,
  };
  const needs = data?.needs_analysis;
  const pct = q?.total ? Math.round((100 * (q.done + q.failed)) / q.total) : 0;
  const hasQueue = q && q.total > 0;
  const needsWork = Boolean(needs?.broken_summary || needs?.null_analysis);
  const busy = actionLoading !== null;
  const failures = data?.recent_failures ?? [];

  if (loading && !data) {
    return (
      <Paper p="sm" radius="sm" data-testid="admin-news-queue-loading">
        <Group gap="sm" justify="center" py="sm">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">Loading queue…</Text>
        </Group>
      </Paper>
    );
  }

  if (!hasQueue && !needsWork) {
    return (
      <Text ta="center" size="sm" c="dimmed" data-testid="admin-news-queue-empty">
        No articles need analysis. All summaries are up to date.
      </Text>
    );
  }

  return (
    <Stack gap="sm" data-testid="admin-news-queue-panel">
      {error && <Alert color="error">{error}</Alert>}

      <CompactStatGrid>
        <CompactStat label="Pending" value={q?.pending ?? "—"} tone={q?.pending ? "warning" : "secondary"} />
        <CompactStat label="Done" value={q?.done ?? "—"} tone="success" />
        <CompactStat label="Failed" value={q?.failed ?? "—"} tone={q?.failed ? "error" : "secondary"} />
        <CompactStat label="Total" value={q?.total ?? "—"} tone="secondary" />
      </CompactStatGrid>

      {hasQueue && (
        <CompactPanel title="Progress">
          <Stack gap={4}>
            <Group justify="space-between">
              <Text size="sm" fw={500}>Progress</Text>
              <Text size="xs" c="dimmed">{q.done + q.failed} / {q.total} ({pct}%)</Text>
            </Group>
            <Progress value={pct} size="md" animated={!!q.pending} />
          </Stack>
        </CompactPanel>
      )}

      <ToolbarRow gap={8} justify="space-between" wrap>
        <Group gap="xs">
          <Button size="sm" leftSection={<IconPlus size={14} />} onClick={() => doAction("enqueue", { limit: 0, force: false })} loading={actionLoading === "enqueue"} disabled={busy} variant="light">
            Enqueue broken
          </Button>
          <Button size="sm" leftSection={<IconPlayerPlay size={14} />} onClick={() => doAction("process", {})} loading={actionLoading === "process"} disabled={busy || !q?.pending}>
            Process next
          </Button>
        </Group>
        <Badge size="lg" variant="outline" color={!needsWork ? "success" : "warning"}>
          {needs?.broken_summary ?? "—"} broken · {needs?.null_analysis ?? "—"} null
        </Badge>
      </ToolbarRow>

      {result && (
        <Paper p="sm" radius="sm" bg={result.failed ? "error.light" : "success.light"}>
          {result.message && !result.processed && !result.failed ? (
            <Text size="sm">{result.message}</Text>
          ) : result.processed ? (
            <Stack gap={2}>
              <Group gap="xs">
                <Badge size="sm" color="success">Done</Badge>
                <Text size="sm" fw={500}>ID {result.article_id}</Text>
                <Badge size="sm" color={result.sentiment === "BULLISH" ? "success" : result.sentiment === "BEARISH" ? "error" : "secondary"}>
                  {result.sentiment}
                </Badge>
                <Text size="xs" c="dimmed">Impact: {result.impact_score}</Text>
              </Group>
              <Text size="xs" lineClamp={1}>{(result.headline || "").slice(0, 120)}</Text>
              <Text size="xs" c="dimmed" lineClamp={2}>{(result.summary || "").slice(0, 200)}</Text>
            </Stack>
          ) : (
            <Stack gap={2}>
              <Group gap="xs">
                <Badge size="sm" color="error">Failed</Badge>
                <Text size="sm" fw={500}>ID {result.article_id}</Text>
              </Group>
              <Text size="xs" c="dimmed">{(result.headline || "").slice(0, 80)}</Text>
              <Text size="xs" c="error">{(result.error || "").slice(0, 200)}</Text>
            </Stack>
          )}
        </Paper>
      )}

      {failures.length > 0 && (
        <CompactPanel title={`Recent failures (${failures.length})`}>
          <Stack gap={4}>
            {failures.map((f) => (
              <Text key={f.queue_id} size="xs" c="dimmed">
                [{f.article_id}] {(f.headline || "").slice(0, 60)} — {f.error?.slice(0, 120)}
              </Text>
            ))}
          </Stack>
        </CompactPanel>
      )}
    </Stack>
  );
}
