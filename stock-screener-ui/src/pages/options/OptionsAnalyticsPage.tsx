/**
 * Full-screen Options Analytics shell.
 *
 * Owns routing, the single fetch lifecycle, the four pillar tabs and the expiry
 * selector. The heavy chart panels are owned by a separate lane and imported
 * lazily so this shell never pulls ECharts/WebGL into the initial chunk — the
 * shell itself has no WebGL requirement. Each panel receives the same three
 * props: `data`, `selectedExpiry`, `onExpiry`.
 */

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  lazy,
  onCleanup,
  Show,
  Suspense,
  type Component,
  type JSX,
} from "solid-js";
import { Dynamic } from "solid-js/web";
import { useParams } from "@solidjs/router";
import {
  Alert,
  Anchor,
  Box,
  Button,
  Center,
  Chip,
  Group,
  Loader,
  Paper,
  Tab,
  Tabs,
  TabsList,
  Text,
  ToolbarRow,
} from "@/ui";
import { EXPIRY_CHIP_FOCUS } from "@/config/focusTokens";
import {
  abortDashboard,
  loadDashboard,
  optionsDashboardState,
  refreshDashboard,
} from "../../state/optionsDashboard";
import type { OptionsDashboardData, PillarKey } from "../../types/optionsDashboard";

export interface PillarPanelProps {
  data: OptionsDashboardData;
  selectedExpiry: string | null;
  onExpiry: (expiry: string) => void;
}

type PanelComponent = Component<PillarPanelProps>;

function panel(
  load: () => Promise<{ default: PanelComponent }>,
): PanelComponent {
  return lazy(load);
}

const PILLARS: Record<PillarKey, PanelComponent> = {
  volatility: panel(() =>
    import("../../components/options-dashboard/VolatilityPillar").then((m) => ({
      default: m.VolatilityPillar as PanelComponent,
    })),
  ),
  positioning: panel(() =>
    import("../../components/options-dashboard/PositioningPillar").then((m) => ({
      default: m.PositioningPillar as PanelComponent,
    })),
  ),
  dealer: panel(() =>
    import("../../components/options-dashboard/DealerPillar").then((m) => ({
      default: m.DealerPillar as PanelComponent,
    })),
  ),
  liquidity: panel(() =>
    import("../../components/options-dashboard/LiquidityPillar").then((m) => ({
      default: m.LiquidityPillar as PanelComponent,
    })),
  ),
};

const PILLAR_TABS: ReadonlyArray<{ key: PillarKey; label: string }> = [
  { key: "volatility", label: "VOLATILITY" },
  { key: "positioning", label: "POSITIONING" },
  { key: "dealer", label: "DEALER" },
  { key: "liquidity", label: "LIQUIDITY" },
];

export default function OptionsAnalyticsPage(): JSX.Element {
  const params = useParams<{ symbol?: string }>();
  const symbol = createMemo(() => String(params.symbol ?? "").trim().toUpperCase());

  const [activeTab, setActiveTab] = createSignal<PillarKey>("volatility");
  const [selectedExpiry, setSelectedExpiry] = createSignal<string | null>(null);

  // One effect owns the read. Cleanup lives on the component owner, not inside
  // the effect: a route-param churn that re-runs the effect must not abort the
  // first flight and start a second one for the same symbol. loadDashboard()
  // already dedupes an identical in-flight symbol and serves cache hits.
  let lastLoaded: string | null = null;
  createEffect(() => {
    const current = symbol();
    if (!current || current === lastLoaded) return;
    lastLoaded = current;
    void loadDashboard(current);
  });
  onCleanup(() => abortDashboard());

  // Keep the selection valid when a new payload arrives; default to the front expiry.
  createEffect(() => {
    const expiries = optionsDashboardState.data?.expiries ?? [];
    const current = selectedExpiry();
    setSelectedExpiry(
      current && expiries.some((expiry) => expiry.date === current)
        ? current
        : (expiries[0]?.date ?? null),
    );
  });

  // The shared Tab primitive moves focus on Arrow/Home/End but does not select.
  // Activate here as well so a keyboard user switches pillars in one keystroke;
  // index-based lookup keeps this independent of how the primitive wires focus.
  const handlePillarKeys = (event: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const target = event.target as HTMLElement | null;
    if (target?.getAttribute("role") !== "tab") return;
    event.preventDefault();
    const list = target.closest('[role="tablist"]');
    const tabs = Array.from(list?.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])') ?? []);
    const idx = tabs.indexOf(target);
    if (idx < 0 || tabs.length === 0) return;
    let next = idx;
    if (event.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
    else if (event.key === "ArrowRight") next = (idx + 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else next = tabs.length - 1;
    tabs[next].focus();
    const pillar = PILLAR_TABS[next]?.key;
    if (pillar) setActiveTab(pillar);
  };

  const ActivePanel = createMemo(() => PILLARS[activeTab()]);
  const hasData = createMemo(() => optionsDashboardState.data != null);
  const isLoading = createMemo(() => optionsDashboardState.status === "loading");

  return (
    <Box
      data-testid="options-analytics-page"
      className="flex flex-col w-full h-full min-h-0 min-w-0 bg-fin-bg text-fin-text overflow-hidden"
    >
      <Paper
        component="header"
        radius={0}
        className="flex flex-col shrink-0 border-b border-fin-border bg-fin-surface px-4 py-2 gap-2"
      >
        <ToolbarRow justify="space-between" data-testid="analytics-header">
          <ToolbarRow gap={8}>
            <Text fw={700} tt="uppercase" data-testid="analytics-symbol">
              {symbol() || "—"}
            </Text>
            <Show when={optionsDashboardState.data?.spot != null}>
              <Text c="dimmed" size="sm" data-testid="analytics-spot">
                {optionsDashboardState.data?.spot}
              </Text>
            </Show>
            <Show when={optionsDashboardState.data?.quotesLive}>
              <Text size="xs" c="success" data-testid="analytics-live">
                LIVE
              </Text>
            </Show>
            <Show when={hasData() && !optionsDashboardState.data?.quotesLive}>
              <Text size="xs" c="dimmed" data-testid="analytics-stale">
                STALE
              </Text>
            </Show>
          </ToolbarRow>
          <Show when={optionsDashboardState.data?.asOf}>
            {(asOf) => (
              <Text size="xs" c="dimmed" data-testid="analytics-as-of">
                {asOf()}
              </Text>
            )}
          </Show>
        </ToolbarRow>

        <Box
          className="min-w-0"
          data-testid="analytics-pillar-tabs-wrap"
          onKeyDown={handlePillarKeys}
        >
          <Tabs
            value={activeTab()}
            onChange={(value) => value && setActiveTab(value as PillarKey)}
            data-testid="analytics-pillar-tabs"
          >
            <TabsList className="border-b-0 min-h-0" data-testid="analytics-pillar-list">
              <For each={PILLAR_TABS}>
                {(tab) => (
                  <Tab
                    value={tab.key}
                    data-testid={`analytics-pillar-tab-${tab.key}`}
                    className="min-h-[26px]"
                  >
                    {tab.label}
                  </Tab>
                )}
              </For>
            </TabsList>
          </Tabs>
        </Box>

        <Show when={optionsDashboardState.data && optionsDashboardState.data.expiries.length > 0}>
          <ToolbarRow gap={4} data-testid="analytics-expiry-row">
            <Text size="xs" c="dimmed">
              EXPIRY
            </Text>
            <For each={optionsDashboardState.data?.expiries ?? []}>
              {(expiry) => (
                <Chip
                  size="xs"
                  checked={selectedExpiry() === expiry.date}
                  className={EXPIRY_CHIP_FOCUS}
                  data-testid={`analytics-expiry-${expiry.date}`}
                  onChange={(checked) => checked && setSelectedExpiry(expiry.date)}
                >
                  {expiry.date}
                </Chip>
              )}
            </For>
          </ToolbarRow>
        </Show>
      </Paper>

      <Show when={optionsDashboardState.status === "error" && optionsDashboardState.error}>
        {(error) => (
          <Alert
            color="error"
            variant="outline"
            radius={0}
            data-testid="analytics-error"
            className="shrink-0"
          >
            <ToolbarRow justify="space-between">
              <Text size="sm">{error().message}</Text>
              <Group gap={8} align="center">
                <Show when={error().kind === "auth"}>
                  <Anchor
                    href="/settings"
                    size="sm"
                    c="primary"
                    data-testid="analytics-reconnect"
                  >
                    Reconnect Upstox
                  </Anchor>
                </Show>
                <Button
                  size="xs"
                  variant="light"
                  data-testid="analytics-retry"
                  onClick={() => void refreshDashboard()}
                >
                  Retry
                </Button>
              </Group>
            </ToolbarRow>
          </Alert>
        )}
      </Show>

      {/* The pillar owns a `flex-1` chain down to the chart grid; without
          `flex-col` here that chain is inert and every chart sits at its min
          height with the page's spare height left blank underneath. Below `sm`
          the body scrolls instead (the pillar turns `flex-none`), so the last
          chart is reachable and the metric band stays after it, never on top. */}
      <Box
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden max-sm:overflow-y-auto"
        data-testid="analytics-body"
      >
        <Show
          when={hasData()}
          fallback={
            <Show
              when={isLoading()}
              fallback={
                <Center className="h-full" data-testid="analytics-empty">
                  <Text c="dimmed" size="sm">
                    No options analytics available for {symbol() || "this symbol"}.
                  </Text>
                </Center>
              }
            >
              <Center className="h-full" data-testid="analytics-loading">
                <Loader />
              </Center>
            </Show>
          }
        >
          <Show
            when={(optionsDashboardState.data?.expiries.length ?? 0) > 0}
            fallback={
              <Center className="h-full" data-testid="analytics-empty">
                <Text c="dimmed" size="sm">
                  No expiries available for {symbol()}.
                </Text>
              </Center>
            }
          >
            <Suspense
              fallback={
                <Center className="h-full" data-testid="analytics-panel-loading">
                  <Loader />
                </Center>
              }
            >
              <Dynamic
                component={ActivePanel()}
                data={optionsDashboardState.data!}
                selectedExpiry={selectedExpiry()}
                onExpiry={(expiry: string) => setSelectedExpiry(expiry)}
              />
            </Suspense>
          </Show>
        </Show>
      </Box>

      <Show when={optionsDashboardState.data?.warnings.length}>
        <Paper component="footer" radius={0} className="shrink-0 border-t border-fin-border px-4 py-1">
          <Text size="xs" c="dimmed" data-testid="analytics-warnings">
            {optionsDashboardState.data?.warnings.map((warning) => warning.message).join(" · ")}
          </Text>
        </Paper>
      </Show>
    </Box>
  );
}
