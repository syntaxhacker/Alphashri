import { Show, Switch, Match, createEffect, createMemo, createSignal, For, onCleanup } from "solid-js";
import { IconChevronLeft, IconChevronRight } from "./icons";
import { ActionIcon, Box, Button, Paper, Select, Skeleton, Text, ToolbarRow } from "@/ui";
import { cn } from "@/ui/cn";
import { fetchSectorGroups } from "../../api/sector";
import type { SectorClassify, SectorGroup, SectorPeriod } from "../../types/sector";
import { formatPercentage, getPnLTextColor } from "../../utils/ui-helpers";

export const GROUP_PERFORMANCE_PERIODS: SectorPeriod[] = [
  "1D",
  "1W",
  "1M",
  "3M",
  "6M",
  "YTD",
  "1Y",
];

interface GroupPerformancePanelProps {
  width?: number;
  onSelectGroup?: (name: string) => void;
  defaultCollapsed?: boolean;
}

function sanitizeTestId(name: string): string {
  return name;
}

export function GroupPerformancePanel(props: GroupPerformancePanelProps) {
  const [classify, setClassify] = createSignal<SectorClassify>("sector");
  const [period, setPeriod] = createSignal<SectorPeriod>("1D");
  const [collapsed, setCollapsed] = createSignal(props.defaultCollapsed ?? false);
  const [minStocks, setMinStocks] = createSignal("3");
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [groups, setGroups] = createSignal<SectorGroup[]>([]);

  createEffect(() => {
    const currentClassify = classify();
    const currentPeriod = period();
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    setLoading(true);
    setError(null);
    fetchSectorGroups({ classify: currentClassify, period: currentPeriod })
      .then((payload) => {
        if (cancelled) return;
        setGroups(Array.isArray(payload.groups) ? payload.groups : []);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load groups");
        setGroups([]);
        setLoading(false);
      });
  });

  // Single/few-stock groups produce noisy outliers (e.g. an industry with one
  // name at +34%); default to hiding groups below the threshold.
  const threshold = () => Number(minStocks()) || 1;
  const visible = createMemo(() => groups().filter((g) => g.stock_count >= threshold()));
  const maxAbs = createMemo(() => visible().reduce((m, g) => Math.max(m, Math.abs(g.change)), 0));

  return (
    <Switch>
      <Match when={collapsed()}>
        <Paper
          radius={2}
          data-testid="group-performance-panel"
          data-collapsed="true"
          w={32}
          className="flex-shrink-0 min-h-0 flex flex-col items-center py-2 border border-fin-border"
        >
          <ActionIcon
            size="xs"
            onClick={() => setCollapsed(false)}
            data-testid="group-performance-toggle"
            aria-label="Expand groups panel"
          >
            <IconChevronRight size={14} />
          </ActionIcon>
        </Paper>
      </Match>
      <Match when={!collapsed()}>
        <Paper
          radius={2}
          data-testid="group-performance-panel"
          data-collapsed="false"
          w={props.width ?? 200}
          className="flex-shrink-0 min-h-0 flex flex-col overflow-hidden border border-fin-border"
        >
          <ToolbarRow gap={4} clip data-testid="group-performance-header" wrap={false}>
            <Box className="flex items-center gap-0 px-2 pt-2 w-full">
              <Text size="xs" fw={600} c="dimmed" tt="uppercase" span className="flex-shrink-0">
                Groups
              </Text>
              <Box className="flex-1 min-w-0" />
              <ActionIcon
                size="xs"
                onClick={() => setCollapsed(true)}
                data-testid="group-performance-toggle"
                aria-label="Collapse groups panel"
              >
                <IconChevronLeft size={14} />
              </ActionIcon>
            </Box>
          </ToolbarRow>
          <Box className="flex flex-wrap gap-8 px-2 pb-2">
            <For each={GROUP_PERFORMANCE_PERIODS}>
              {(p) => (
                <Button
                  size="xs"
                  variant={p === period() ? "filled" : "subtle"}
                  onClick={() => setPeriod(p)}
                  data-testid={`group-performance-period-${p}`}
                >
                  {p}
                </Button>
              )}
            </For>
          </Box>
          <Box className="flex items-center gap-2 px-2 pb-2">
            <Box className="flex-1 min-w-0">
              <Select
                value={classify()}
                onChange={(v) => {
                  if (v === "sector" || v === "industry" || v === "theme") setClassify(v);
                }}
                data={[
                  { value: "sector", label: "Sector" },
                  { value: "industry", label: "Industry" },
                  { value: "theme", label: "Theme" },
                ]}
                size="xs"
                data-testid="group-performance-classify"
                aria-label="Classify"
              />
            </Box>
            <Select
              value={minStocks()}
              onChange={(v) => setMinStocks(String(v ?? "3"))}
              data={[
                { value: "1", label: "All" },
                { value: "3", label: "3+" },
                { value: "5", label: "5+" },
                { value: "10", label: "10+" },
              ]}
              size="xs"
              w={72}
              data-testid="group-performance-min-stocks"
              aria-label="Minimum stocks"
            />
          </Box>
          <Switch>
            <Match when={loading()}>
              <Box className="flex flex-col gap-2 p-2" data-testid="group-performance-loading">
                <Skeleton h={16} />
                <Skeleton h={16} />
                <Skeleton h={16} />
                <Skeleton h={16} />
              </Box>
            </Match>
            <Match when={error()}>
              <Box className="p-2" data-testid="group-performance-error">
                <Text size="xs" c="error">
                  {error()}
                </Text>
              </Box>
            </Match>
            <Match when={visible().length === 0}>
              <Box className="p-2" data-testid="group-performance-empty">
                <Text size="xs" c="dimmed">
                  No groups found
                </Text>
              </Box>
            </Match>
            <Match when={visible().length > 0}>
              <Box className="flex-1 min-h-0 overflow-y-auto flex flex-col px-1 pb-1" data-testid="group-performance-list">
                <For each={visible()}>
                  {(g) => {
                    const pct = maxAbs() > 0 ? (Math.abs(g.change) / maxAbs()) * 100 : 0;
                    const positive = g.change >= 0;
                    return (
                      <Box
                        data-testid={`group-performance-row-${sanitizeTestId(g.name)}`}
                        data-group={g.name}
                        onClick={props.onSelectGroup ? () => props.onSelectGroup?.(g.name) : undefined}
                        className={cn("flex flex-col gap-4 py-[2px] border-b border-fin-border", props.onSelectGroup ? "cursor-pointer" : "cursor-default")}
                      >
                        <Box className="flex items-center gap-2 min-w-0">
                          <Text size="xs" truncate span className="flex-1 min-w-0" title={g.name}>
                            {g.name}
                          </Text>
                          <Text size="xs" c="dimmed" span className="flex-shrink-0 font-mono tabular-nums">
                            {g.stock_count}
                          </Text>
                        </Box>
                        <Box className="flex items-center gap-2">
                          <Box className="flex-1 min-w-0 h-[6px] rounded-sm overflow-hidden bg-fin-surface-alt">
                            <Box
                              data-testid={`group-performance-bar-${sanitizeTestId(g.name)}`}
                              data-value={g.change}
                              data-positive={positive ? "true" : "false"}
                              className="h-full rounded-sm"
                              style={{
                                width: `${pct}%`,
                                "background-color": positive ? "var(--color-fin-positive)" : "var(--color-fin-negative)",
                              }}
                            />
                          </Box>
                          <Text
                            size="xs"
                            c={getPnLTextColor(g.change)}
                            span
                            ta="right"
                            className="w-[56px] flex-shrink-0 font-mono tabular-nums"
                            data-testid={`group-performance-value-${sanitizeTestId(g.name)}`}
                          >
                            {formatPercentage(g.change)}
                          </Text>
                        </Box>
                      </Box>
                    );
                  }}
                </For>
              </Box>
            </Match>
          </Switch>
        </Paper>
      </Match>
    </Switch>
  );
}
