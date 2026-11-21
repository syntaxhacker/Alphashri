import { createMemo, For, Match, Show, Switch, type Accessor, type JSX } from "solid-js";
import { Badge, Box, Button, Loader, Text, useMediaQuery } from "@/ui";
import type { CatalystBreadth, CatalystSector, CatalystToday } from "@/api/catalysts";
import { useCatalystToday } from "@/state/catalystStore";
import type { DockPanelApi, DockPanelContext, DockPanelSpec } from "../dock/types";
import { getPanelSpec } from "../window/panelRegistry";
import { formatIstStamp, isSafeSourceUrl } from "../catalyst/catalystRows";
import { formatPercentage } from "@/utils/ui-helpers";

/**
 * The Monitor owns no data: every region is either a registered dock panel or a
 * presentation of the one shared catalyst payload. Mounting the panel specs
 * means a region cannot drift from the Desk rendering of the same source.
 */
const MONITOR_CONTEXT: DockPanelContext = { symbol: "NIFTY", market: "india", timeframe: "1m" };
const context: Accessor<DockPanelContext> = () => MONITOR_CONTEXT;

const PANEL_API: DockPanelApi = {
  data: () => undefined,
  commands: {},
  settings: () => ({}),
  onSettingsChange: () => {},
};

const CATALYST_RADAR_ID = "catalyst.radar";

type CheckStatus = "pass" | "fail" | "pending";

interface SessionCheck {
  id: string;
  label: string;
  status: CheckStatus;
  value: string;
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function countText(value: number | null | undefined): string {
  const n = finite(value);
  return n === null ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function volumeText(value: number | null | undefined): string {
  const n = finite(value);
  return n === null ? "—" : `${n.toFixed(1)}×`;
}

function changeTone(value: number | null): "success" | "error" | "dimmed" {
  if (value === null || value === 0) return "dimmed";
  return value > 0 ? "success" : "error";
}

function breadthValue(breadth: CatalystBreadth | null): string {
  if (!breadth) return "—";
  const advancing = countText(breadth.advancing);
  const declining = countText(breadth.declining);
  if (advancing === "—" && declining === "—") return "—";
  const total = countText(breadth.total);
  return total === "—" ? `${advancing} / ${declining}` : `${advancing} / ${declining} of ${total}`;
}

function maxRelVolume(data: CatalystToday): number | null {
  let max: number | null = null;
  for (const row of data.rows ?? []) {
    const value = finite(row.rel_volume);
    if (value === null) continue;
    if (max === null || value > max) max = value;
  }
  return max;
}

function scheduledCount(data: CatalystToday): number {
  return (data.rows ?? []).filter((row) => row.kind === "event" && row.state === "scheduled").length;
}

function positioningCount(data: CatalystToday): number {
  return (data.rows ?? []).filter((row) => row.kind === "positioning").length;
}

/**
 * Each line either has a measurement or is explicitly pending. A missing field
 * never becomes a green tick: that would turn "source unavailable" into "all
 * clear", which is the exact failure the empty-state rules exist to prevent.
 */
export function buildSessionChecks(data: CatalystToday): SessionCheck[] {
  const sector: CatalystSector | null = data.sector;
  const change = finite(sector?.change_pct);
  const relative = finite(sector?.relative_strength_pct);
  const advancing = finite(sector?.breadth?.advancing);
  const declining = finite(sector?.breadth?.declining);
  const volume = maxRelVolume(data);
  const scheduled = scheduledCount(data);
  const positioning = positioningCount(data);

  return [
    {
      id: "scheduled",
      label: "Scheduled catalyst",
      status: scheduled > 0 ? "pass" : "fail",
      value: `${scheduled} scheduled`,
    },
    {
      id: "demand",
      label: "Demand tailwind",
      status: change === null ? "pending" : change > 0 ? "pass" : "fail",
      value: change === null ? "—" : formatPercentage(change, 2, true),
    },
    {
      id: "positioning",
      label: "Positioning",
      status: positioning > 0 ? "pass" : "fail",
      value: `${positioning} flagged`,
    },
    {
      id: "relative-strength",
      label: "Relative strength",
      status: relative === null ? "pending" : relative > 0 ? "pass" : "fail",
      value: relative === null ? "—" : formatPercentage(relative, 2, true),
    },
    {
      id: "breadth",
      label: "Breadth",
      status:
        advancing === null || declining === null
          ? "pending"
          : advancing > declining
            ? "pass"
            : "fail",
      value: breadthValue(sector?.breadth ?? null),
    },
    {
      id: "volume",
      label: "Volume",
      status: volume === null ? "pending" : volume >= 1.5 ? "pass" : "fail",
      value: volumeText(volume),
    },
  ];
}

const STATUS_BADGE: Record<CheckStatus, { label: string; color: string }> = {
  pass: { label: "PASS", color: "success" },
  fail: { label: "FAIL", color: "error" },
  pending: { label: "N/A", color: "dimmed" },
};

function MonitorPanel(props: {
  title: string;
  testId: string;
  heading?: boolean;
  className?: string;
  children: JSX.Element;
}) {
  return (
    <section
      data-testid={props.testId}
      role="region"
      aria-label={props.title}
      class={`flex min-h-0 min-w-0 flex-col overflow-hidden border border-fin-border bg-fin-surface ${props.className ?? ""}`}
    >
      <Show when={props.heading}>
        <header class="flex h-7 shrink-0 items-center border-b border-fin-border bg-fin-surface-alt px-2">
          <Text size="xs" fw={700} className="min-w-0 truncate uppercase tracking-wide">
            {props.title}
          </Text>
        </header>
      </Show>
      <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{props.children}</div>
    </section>
  );
}

function RegionNote(props: { testId: string; children: JSX.Element }) {
  return (
    <Box
      data-testid={props.testId}
      class="flex h-full min-h-0 items-center justify-center px-3 py-2 text-center"
    >
      <Text size="xs" c="dimmed">
        {props.children}
      </Text>
    </Box>
  );
}

function RegionError(props: { testId: string; message: string; onRetry: () => void }) {
  return (
    <Box
      data-testid={props.testId}
      role="alert"
      class="flex h-full min-h-0 flex-col items-center justify-center gap-2 px-3 py-2 text-center"
    >
      <Text size="xs" c="error">
        {props.message}
      </Text>
      <Button size="xs" variant="subtle" onClick={props.onRetry}>
        Retry
      </Button>
    </Box>
  );
}

function RegionLoading(props: { testId: string; label: string }) {
  return (
    <Box
      data-testid={props.testId}
      class="flex h-full min-h-0 items-center justify-center gap-2 px-3 py-2"
    >
      <Loader size="xs" />
      <Text size="xs" c="dimmed">
        {props.label}
      </Text>
    </Box>
  );
}

/**
 * A dock panel rendered in place. `getPanelSpec` is the only registry lookup:
 * an unregistered id is an explicit gap, not a silently blank cell.
 */
function PanelRegion(props: { id: string; title: string; testId: string; className?: string; heading?: boolean }) {
  const spec = createMemo<DockPanelSpec | undefined>(() => getPanelSpec(props.id));
  return (
    <MonitorPanel title={props.title} testId={props.testId} heading={props.heading} className={props.className}>
      <Show
        when={spec()}
        fallback={
          <RegionNote testId={`${props.testId}-missing`}>
            {props.title} panel is not registered.
          </RegionNote>
        }
      >
        {spec()!.mount(context, PANEL_API)}
      </Show>
    </MonitorPanel>
  );
}

function SectorPulse() {
  const store = useCatalystToday();
  const data = () => store.data();
  const sector = () => data()?.sector ?? null;

  const advancing = () => finite(sector()?.breadth?.advancing);
  const total = () => finite(sector()?.breadth?.total);
  const advancingWidth = () => {
    const adv = advancing();
    const all = total();
    if (adv === null || all === null || all <= 0) return null;
    return Math.max(0, Math.min(100, (adv / all) * 100));
  };

  return (
    <MonitorPanel title="SECTOR PULSE" testId="monitor-auto-pulse" heading className="shrink-0">
      <Switch>
        <Match when={store.error() && !data()}>
          <RegionError
            testId="monitor-auto-error"
            message={store.error() ?? "Sector pulse unavailable"}
            onRetry={store.refresh}
          />
        </Match>
        <Match when={store.loading() && !data()}>
          <RegionLoading testId="monitor-auto-loading" label="Loading sector pulse…" />
        </Match>
        <Match when={!data()}>
          <RegionNote testId="monitor-auto-empty">No sector pulse yet.</RegionNote>
        </Match>
        <Match when={!sector()}>
          <RegionNote testId="monitor-auto-empty">
            Today's snapshot has no sector pulse.
          </RegionNote>
        </Match>
        <Match when={true}>
          <Box className="flex min-h-0 flex-col gap-1.5 px-2 py-1.5">
            <Box className="flex items-baseline justify-between gap-2">
              <Text size="xs" fw={700} data-testid="monitor-auto-label">
                {sector()?.label ?? "SECTOR"}
              </Text>
              <Text
                size="xs"
                fw={700}
                className="font-mono tabular-nums"
                c={
                  finite(sector()?.change_pct) === null
                    ? "dimmed"
                    : (sector()!.change_pct as number) > 0
                      ? "success"
                      : (sector()!.change_pct as number) < 0
                        ? "error"
                        : "dimmed"
                }
                data-testid="monitor-auto-change"
              >
                {formatPercentage(sector()?.change_pct, 2, true)}
              </Text>
            </Box>

            <Box className="flex items-baseline justify-between gap-2">
              <Text size="xs" c="dimmed">RELATIVE STRENGTH</Text>
              <Text
                size="xs"
                fw={600}
                className="font-mono tabular-nums"
                data-testid="monitor-auto-rs"
              >
                {formatPercentage(sector()?.relative_strength_pct, 2, true)}
              </Text>
            </Box>

            <Box className="flex items-baseline justify-between gap-2">
              <Text size="xs" c="dimmed">BREADTH</Text>
              <Text
                size="xs"
                fw={600}
                className="font-mono tabular-nums"
                data-testid="monitor-auto-breadth"
              >
                {breadthValue(sector()?.breadth ?? null)}
              </Text>
            </Box>

            <Show when={advancingWidth() !== null}>
              <Box className="h-1 w-full overflow-hidden bg-fin-negative" aria-hidden="true">
                <Box
                  class="h-full bg-fin-positive"
                  style={{ width: `${advancingWidth()}%` }}
                />
              </Box>
            </Show>

            <Box className="flex items-baseline justify-between gap-2">
              <Text size="xs" c="dimmed">INDIA VIX</Text>
              <Text
                size="xs"
                fw={600}
                className="font-mono tabular-nums"
                data-testid="monitor-auto-vix"
              >
                {finite(data()?.market?.vix) === null
                  ? "—"
                  : (data()!.market!.vix as number).toFixed(2)}
              </Text>
            </Box>
          </Box>
        </Match>
      </Switch>
    </MonitorPanel>
  );
}

function SessionPlan() {
  const store = useCatalystToday();
  const data = () => store.data();
  const checks = () => {
    const payload = data();
    return payload ? buildSessionChecks(payload) : [];
  };

  return (
    <MonitorPanel title="SESSION PLAN" testId="home-session-plan" heading className="shrink-0">
      <Switch>
        <Match when={store.error() && !data()}>
          <RegionError
            testId="session-plan-error"
            message={store.error() ?? "Session plan unavailable"}
            onRetry={store.refresh}
          />
        </Match>
        <Match when={store.loading() && !data()}>
          <RegionLoading testId="session-plan-loading" label="Loading session plan…" />
        </Match>
        <Match when={!data()}>
          <RegionNote testId="session-plan-empty">
            Waiting for the first catalyst snapshot.
          </RegionNote>
        </Match>
        <Match when={true}>
          <Box className="flex min-h-0 flex-col divide-y divide-fin-border">
            <For each={checks()}>
              {(check) => (
                <Box
                  data-testid={`session-check-${check.id}`}
                  data-status={check.status}
                  class="flex items-center gap-2 px-2 py-1"
                >
                  <Text size="xs" className="min-w-0 flex-1 truncate">
                    {check.label}
                  </Text>
                  <Text
                    size="xs"
                    c="dimmed"
                    className="shrink-0 font-mono tabular-nums"
                    data-testid={`session-check-${check.id}-value`}
                  >
                    {check.value}
                  </Text>
                  <Badge
                    size="xs"
                    variant="dot"
                    color={STATUS_BADGE[check.status].color}
                    data-testid={`session-check-${check.id}-status`}
                  >
                    {STATUS_BADGE[check.status].label}
                  </Badge>
                </Box>
              )}
            </For>
          </Box>
        </Match>
      </Switch>
    </MonitorPanel>
  );
}

function CatalystRegion(props: { className?: string }) {
  return (
    <PanelRegion
      id={CATALYST_RADAR_ID}
      title="CATALYST RADAR"
      testId="monitor-region-catalyst"
      className={props.className}
    />
  );
}

function SectorLeaders(props: { className?: string }) {
  const store = useCatalystToday();
  const rows = createMemo(() =>
    [...(store.data()?.rows ?? [])]
      .filter((row) => finite(row.move_pct) !== null)
      .sort((a, b) => Math.abs(b.move_pct ?? 0) - Math.abs(a.move_pct ?? 0))
      .slice(0, 5),
  );

  return (
    <MonitorPanel title="SECTOR LEADERS" testId="monitor-auto-leaders" heading className={props.className}>
      <Switch>
        <Match when={store.error() && !store.data()}>
          <RegionError
            testId="monitor-leaders-error"
            message={store.error() ?? "Leaders unavailable"}
            onRetry={store.refresh}
          />
        </Match>
        <Match when={store.loading() && !store.data()}>
          <RegionLoading testId="monitor-leaders-loading" label="Loading leaders…" />
        </Match>
        <Match when={rows().length === 0}>
          <RegionNote testId="monitor-leaders-empty">No confirmed leaders yet.</RegionNote>
        </Match>
        <Match when={true}>
          <Box className="flex min-h-0 flex-col divide-y divide-fin-border">
            <For each={rows()}>
              {(row) => (
                <Box
                  data-testid={`monitor-leader-${row.symbol}`}
                  class="flex items-baseline gap-2 px-2 py-1"
                >
                  <Text size="xs" fw={700} className="min-w-0 flex-1 truncate">
                    {row.symbol}
                  </Text>
                  <Text size="xs" c="dimmed" className="min-w-0 max-w-[110px] truncate">
                    {row.name ?? "—"}
                  </Text>
                  <Text
                    size="xs"
                    fw={700}
                    c={changeTone(finite(row.move_pct))}
                    className="shrink-0 font-mono tabular-nums"
                  >
                    {formatPercentage(row.move_pct, 2, true)}
                  </Text>
                  <Text size="xs" c="dimmed" className="w-10 shrink-0 text-right font-mono tabular-nums">
                    {volumeText(row.rel_volume)}
                  </Text>
                </Box>
              )}
            </For>
          </Box>
        </Match>
      </Switch>
    </MonitorPanel>
  );
}

function CatalystNews(props: { className?: string }) {
  const store = useCatalystToday();
  const rows = createMemo(() =>
    (store.data()?.rows ?? [])
      .filter((row) => (row.headline ?? "").trim() !== "")
      .slice(0, 5),
  );

  return (
    <MonitorPanel title="CATALYST NEWS" testId="monitor-catalyst-news" heading className={props.className}>
      <Switch>
        <Match when={store.error() && !store.data()}>
          <RegionError
            testId="monitor-news-error"
            message={store.error() ?? "Catalyst news unavailable"}
            onRetry={store.refresh}
          />
        </Match>
        <Match when={store.loading() && !store.data()}>
          <RegionLoading testId="monitor-news-loading" label="Loading catalyst news…" />
        </Match>
        <Match when={rows().length === 0}>
          <RegionNote testId="monitor-news-empty">No catalyst headlines yet.</RegionNote>
        </Match>
        <Match when={true}>
          <Box className="flex min-h-0 flex-col divide-y divide-fin-border">
            <For each={rows()}>
              {(row) => {
                const url = () => (isSafeSourceUrl(row.source_url) ? row.source_url : null);
                return (
                  <Box
                    data-testid={`monitor-news-item-${row.symbol}`}
                    class="flex min-w-0 flex-col gap-0.5 px-2 py-1"
                  >
                    <Show
                      when={url()}
                      fallback={<Text size="xs" className="min-w-0">{row.headline}</Text>}
                    >
                      {(href) => (
                        <a
                          href={href()}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="min-w-0 text-xs leading-snug text-fin-text hover:text-fin-primary"
                        >
                          {row.headline}
                        </a>
                      )}
                    </Show>
                    <Text size="xs" c="dimmed" className="font-mono">
                      {row.source ?? "Source"} · {formatIstStamp(row.first_seen)}
                    </Text>
                  </Box>
                );
              }}
            </For>
          </Box>
        </Match>
      </Switch>
    </MonitorPanel>
  );
}

/** 42 / 34 / 24 of the track space: the radar needs the width to keep its
 * confirmation and score columns visible; ratios keep gutters in the viewport. */
const THREE_COLUMN_TEMPLATE = "minmax(0, 42fr) minmax(0, 34fr) minmax(0, 24fr)";
const TWO_COLUMN_TEMPLATE = "minmax(0, 1fr) minmax(0, 1fr)";
const ONE_COLUMN_TEMPLATE = "minmax(0, 1fr)";

export function HomeMonitorView() {
  const wide = useMediaQuery("(min-width: 1200px)", false);
  const medium = useMediaQuery("(min-width: 700px)", false);
  const columns = () => (wide() ? 3 : medium() ? 2 : 1);
  const template = () =>
    columns() === 3
      ? THREE_COLUMN_TEMPLATE
      : columns() === 2
        ? TWO_COLUMN_TEMPLATE
        : ONE_COLUMN_TEMPLATE;

  return (
    <Box
      data-testid="home-monitor-view"
      data-columns={String(columns())}
      style={{
        "grid-template-columns": template(),
        "grid-template-rows": columns() === 1 ? "none" : "minmax(0, 1fr)",
      }}
      class="grid min-h-0 min-w-0 flex-1 gap-2 overflow-x-hidden overflow-y-auto"
    >
      <Switch>
        <Match when={columns() === 3}>
          <Box className="flex min-h-0 min-w-0 flex-col gap-2">
            <CatalystRegion className="flex-1" />
          </Box>
          <Box className="flex min-h-0 min-w-0 flex-col gap-2">
            <SectorPulse />
            <SectorLeaders className="min-h-0 flex-1" />
          </Box>
          <Box className="flex min-h-0 min-w-0 flex-col gap-2">
            <SessionPlan />
            <CatalystNews className="min-h-0 flex-1" />
          </Box>
        </Match>

        <Match when={columns() === 2}>
          <Box className="flex min-h-0 min-w-0 flex-col gap-2">
            <CatalystRegion className="min-h-[280px] flex-1" />
            <SectorLeaders className="min-h-[220px] flex-1" />
          </Box>
          <Box className="flex min-h-0 min-w-0 flex-col gap-2">
            <SectorPulse />
            <SessionPlan />
            <CatalystNews className="min-h-[220px] flex-1" />
          </Box>
        </Match>

        <Match when={columns() === 1}>
          <Box className="flex min-w-0 flex-col gap-2">
            <CatalystRegion className="min-h-[360px]" />
            <SectorPulse />
            <SectorLeaders className="min-h-[220px]" />
            <SessionPlan />
            <CatalystNews className="min-h-[220px]" />
          </Box>
        </Match>
      </Switch>
    </Box>
  );
}
