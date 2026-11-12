import { createSignal, createMemo, Show, For, Switch, Match } from "solid-js";
import { usePolling } from "@/hooks/usePolling";
import { Alert, Badge, Button, Group, Loader, Paper, Progress, Stack, Text } from "@/ui";
import { ToolbarRow } from "@/ui";
import { Icon } from "../../components/common/Icons";
import { useAuth } from "../../components/auth/AuthProvider2";
import { CompactPanel, CompactStat, CompactStatGrid } from "../../components/common/compact";
import type { NewsAnalysisQueueStatus, NewsAnalysisQueueStatusResponse } from "../../types/admin";

import { API_BASE } from "@/api/config";

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
  const [data, setData] = createSignal<NewsAnalysisQueueStatusResponse | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [actionLoading, setActionLoading] = createSignal<string | null>(null);
  const [result, setResult] = createSignal<ProcessResult | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  let loaded = false;

  const fetchStatus = async () => {
    if (!loaded) setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/admin/news-queue/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      loaded = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

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

  usePolling(fetchStatus, 5000, { immediate: true, skipIfRunning: false });

  const vm = createMemo(() => {
    const d = data();
    const qq: NewsAnalysisQueueStatus = d?.queue ?? {
      pending: 0,
      processing: 0,
      done: 0,
      failed: 0,
      total: 0,
    };
    const needs = d?.needs_analysis;
    const pct = qq?.total ? Math.round((100 * (qq.done + qq.failed)) / qq.total) : 0;
    const hasQueue = Boolean(qq && qq.total > 0);
    const needsWork = Boolean(needs?.broken_summary || needs?.null_analysis);
    const failures = d?.recent_failures ?? [];
    return { qq, needs, pct, hasQueue, needsWork, failures };
  });

  const busy = () => actionLoading() !== null;

  return (
    <Show
      when={!loading() || data()}
      fallback={
        <Paper p="sm" radius="sm" data-testid="admin-news-queue-loading">
          <Group gap="sm" justify="center" py="sm">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">Loading queue…</Text>
          </Group>
        </Paper>
      }
    >
      <Show
        when={vm().hasQueue || vm().needsWork}
        fallback={
          <Text ta="center" size="sm" c="dimmed" data-testid="admin-news-queue-empty">
            No articles need analysis. All summaries are up to date.
          </Text>
        }
      >
        <Stack gap="sm" data-testid="admin-news-queue-panel">
          <Show when={error()}>
            <Alert color="error">{error()}</Alert>
          </Show>

          <CompactStatGrid>
            <CompactStat label="Pending" value={vm().qq?.pending ?? "—"} tone={vm().qq?.pending ? "warning" : "secondary"} />
            <CompactStat label="Done" value={vm().qq?.done ?? "—"} tone="success" />
            <CompactStat label="Failed" value={vm().qq?.failed ?? "—"} tone={vm().qq?.failed ? "error" : "secondary"} />
            <CompactStat label="Total" value={vm().qq?.total ?? "—"} tone="secondary" />
          </CompactStatGrid>

          <Show when={vm().hasQueue}>
            <CompactPanel title="Progress">
              <Stack gap={4}>
                <Group justify="space-between">
                  <Text size="sm" fw={500}>Progress</Text>
                  <Text size="xs" c="dimmed">{vm().qq.done + vm().qq.failed} / {vm().qq.total} ({vm().pct}%)</Text>
                </Group>
                <Progress value={vm().pct} size="md" animated={!!vm().qq.pending} />
              </Stack>
            </CompactPanel>
          </Show>

          <ToolbarRow gap={8} justify="space-between" wrap>
            <Group gap="xs">
              <Show when={busy()} fallback={
                <Button size="sm" leftSection={<Icon name="plus" size={14} />} onClick={() => doAction("enqueue", { limit: 0, force: false })} loading={actionLoading() === "enqueue"} variant="light">
                  Enqueue broken
                </Button>
              }>
                <Button size="sm" leftSection={<Icon name="plus" size={14} />} onClick={() => doAction("enqueue", { limit: 0, force: false })} loading={actionLoading() === "enqueue"} disabled variant="light">
                  Enqueue broken
                </Button>
              </Show>
              <Show when={busy() || !vm().qq?.pending} fallback={
                <Button size="sm" leftSection={<Icon name="player-play" size={14} />} onClick={() => doAction("process", {})} loading={actionLoading() === "process"}>
                  Process next
                </Button>
              }>
                <Button size="sm" leftSection={<Icon name="player-play" size={14} />} onClick={() => doAction("process", {})} loading={actionLoading() === "process"} disabled>
                  Process next
                </Button>
              </Show>
            </Group>
            <Badge size="lg" variant="outline" color={!vm().needsWork ? "success" : "warning"}>
              {vm().needs?.broken_summary ?? "—"} broken · {vm().needs?.null_analysis ?? "—"} null
            </Badge>
          </ToolbarRow>

          <Show when={result()}>
            {(r) => (
              <Paper p="sm" radius="sm" bg={r().failed ? "error.light" : "success.light"}>
                <Switch
                  fallback={
                    <Stack gap={2}>
                      <Group gap="xs">
                        <Badge size="sm" color="error">Failed</Badge>
                        <Text size="sm" fw={500}>ID {r().article_id}</Text>
                      </Group>
                      <Text size="xs" c="dimmed">{(r().headline || "").slice(0, 80)}</Text>
                      <Text size="xs" c="error">{(r().error || "").slice(0, 200)}</Text>
                    </Stack>
                  }
                >
                  <Match when={r().message && !r().processed && !r().failed}>
                    <Text size="sm">{r().message}</Text>
                  </Match>
                  <Match when={r().processed}>
                    <Stack gap={2}>
                      <Group gap="xs">
                        <Badge size="sm" color="success">Done</Badge>
                        <Text size="sm" fw={500}>ID {r().article_id}</Text>
                        <Badge size="sm" color={r().sentiment === "BULLISH" ? "success" : r().sentiment === "BEARISH" ? "error" : "secondary"}>
                          {r().sentiment}
                        </Badge>
                        <Text size="xs" c="dimmed">Impact: {r().impact_score}</Text>
                      </Group>
                      <Text size="xs" lineClamp={1}>{(r().headline || "").slice(0, 120)}</Text>
                      <Text size="xs" c="dimmed" lineClamp={2}>{(r().summary || "").slice(0, 200)}</Text>
                    </Stack>
                  </Match>
                </Switch>
              </Paper>
            )}
          </Show>

          <Show when={vm().failures.length > 0}>
            <CompactPanel title={`Recent failures (${vm().failures.length})`}>
              <Stack gap={4}>
                <For each={vm().failures}>
                  {(f) => (
                    <Text size="xs" c="dimmed">
                      [{f.article_id}] {(f.headline || "").slice(0, 60)} — {f.error?.slice(0, 120)}
                    </Text>
                  )}
                </For>
              </Stack>
            </CompactPanel>
          </Show>
        </Stack>
      </Show>
    </Show>
  );
}
