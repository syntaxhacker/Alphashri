import { createSignal, createMemo, Show, For, Switch, Match } from "solid-js";
import { usePolling } from "@/hooks/usePolling";
import { Alert, Badge, Box, Button, Loader, Progress, Stack, Text } from "@/ui";
import { ToolbarRow } from "@/ui";
import { Icon } from "../../components/common/Icons";
import { useAuth } from "../../components/auth/AuthProvider2";
import { CompactPanel, CompactStat, CompactStatGrid } from "../../components/common/compact";
import type { NewsAnalysisQueueStatus, NewsAnalysisQueueStatusResponse } from "../../types/admin";

import { API_BASE } from "@/api/config";

const MONO = "font-mono tabular-nums text-[11px]";

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
        <Box data-testid="admin-news-queue-loading" className="flex items-center gap-1 p-1">
          <Loader size="xs" />
          <Text size="xs" c="dimmed">Loading queue…</Text>
        </Box>
      }
    >
      <Show
        when={vm().hasQueue || vm().needsWork}
        fallback={
          <Text size="xs" c="dimmed" data-testid="admin-news-queue-empty">
            No articles need analysis. All summaries are up to date.
          </Text>
        }
      >
        <Stack gap={4} className="h-full min-h-0 overflow-auto" data-testid="admin-news-queue-panel">
          <Show when={error()}>
            <Alert color="error" data-testid="admin-news-queue-error">{error()}</Alert>
          </Show>

          <CompactStatGrid cols={4} spacing={4}>
            <CompactStat dense label="Pending" value={vm().qq?.pending ?? "—"} tone={vm().qq?.pending ? "warning" : "secondary"} />
            <CompactStat dense label="Done" value={vm().qq?.done ?? "—"} tone="success" />
            <CompactStat dense label="Failed" value={vm().qq?.failed ?? "—"} tone={vm().qq?.failed ? "error" : "secondary"} />
            <CompactStat dense label="Total" value={vm().qq?.total ?? "—"} tone="secondary" />
          </CompactStatGrid>

          <Show when={vm().hasQueue}>
            <CompactPanel title="Progress" flush>
              <Stack gap={2} className="px-1 py-[2px]">
                <ToolbarRow gap={4} justify="space-between" wrap={false}>
                  <Text size="xs" fw={500}>Progress</Text>
                  <Text size="xs" c="dimmed" class={MONO}>{vm().qq.done + vm().qq.failed} / {vm().qq.total} ({vm().pct}%)</Text>
                </ToolbarRow>
                <Progress value={vm().pct} size="sm" animated={!!vm().qq.pending} />
              </Stack>
            </CompactPanel>
          </Show>

          <ToolbarRow gap={4} justify="space-between" wrap={false}>
            <ToolbarRow gap={4} wrap={false}>
              <Show when={busy()} fallback={
                <Button size="xs" leftSection={<Icon name="plus" size={12} />} onClick={() => doAction("enqueue", { limit: 0, force: false })} loading={actionLoading() === "enqueue"} variant="light">
                  Enqueue broken
                </Button>
              }>
                <Button size="xs" leftSection={<Icon name="plus" size={12} />} onClick={() => doAction("enqueue", { limit: 0, force: false })} loading={actionLoading() === "enqueue"} disabled variant="light">
                  Enqueue broken
                </Button>
              </Show>
              <Show when={busy() || !vm().qq?.pending} fallback={
                <Button size="xs" leftSection={<Icon name="player-play" size={12} />} onClick={() => doAction("process", {})} loading={actionLoading() === "process"}>
                  Process next
                </Button>
              }>
                <Button size="xs" leftSection={<Icon name="player-play" size={12} />} onClick={() => doAction("process", {})} loading={actionLoading() === "process"} disabled>
                  Process next
                </Button>
              </Show>
            </ToolbarRow>
            <Badge size="xs" variant="outline" color={!vm().needsWork ? "success" : "warning"}>
              {vm().needs?.broken_summary ?? "—"} broken · {vm().needs?.null_analysis ?? "—"} null
            </Badge>
          </ToolbarRow>

          <Show when={result()}>
            {(r) => (
              <Box p="xs" radius="sm" className="border border-fin-border" data-testid="ofj-news-result">
                <Switch
                  fallback={
                    <Stack gap={2}>
                      <ToolbarRow gap={4}>
                        <Badge size="xs" color="error">Failed</Badge>
                        <Text size="xs" fw={500}>ID {r().article_id}</Text>
                      </ToolbarRow>
                      <Text size="xs" c="dimmed">{(r().headline || "").slice(0, 80)}</Text>
                      <Text size="xs" c="error">{(r().error || "").slice(0, 200)}</Text>
                    </Stack>
                  }
                >
                  <Match when={r().message && !r().processed && !r().failed}>
                    <Text size="xs">{r().message}</Text>
                  </Match>
                  <Match when={r().processed}>
                    <Stack gap={2}>
                      <ToolbarRow gap={4}>
                        <Badge size="xs" color="success">Done</Badge>
                        <Text size="xs" fw={500}>ID {r().article_id}</Text>
                        <Badge size="xs" color={r().sentiment === "BULLISH" ? "success" : r().sentiment === "BEARISH" ? "error" : "secondary"}>
                          {r().sentiment}
                        </Badge>
                        <Text size="xs" c="dimmed" class={MONO}>Impact: {r().impact_score}</Text>
                      </ToolbarRow>
                      <Text size="xs" lineClamp={1}>{(r().headline || "").slice(0, 120)}</Text>
                      <Text size="xs" c="dimmed" lineClamp={2}>{(r().summary || "").slice(0, 200)}</Text>
                    </Stack>
                  </Match>
                </Switch>
              </Box>
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
