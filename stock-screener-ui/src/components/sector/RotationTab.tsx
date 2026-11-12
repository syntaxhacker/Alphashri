import { Show, Switch, Match, For, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Loader,
  SegmentedControl,
  Select,
  Text,
  ToolbarRow,
} from "@/ui";
import { CompactPanel } from "@/components/common/compact";
import { IconRefresh } from "../screener/icons";
import { NEGATIVE, POSITIVE, WARNING } from "@/ui/palette";
import type {
  RotationKind,
  RotationPeriod,
  RotationRow,
  RotationStatus,
} from "../../types/rotation";
import type { RotationOverviewResponse } from "../../types/rotation";
import { fetchRotationOverview } from "../../api/rotation";
import { formatPercentage, formatTimeOnly } from "../../utils/ui-helpers";
import { RotationRrg } from "./RotationRrg";
import { RotationMatrix } from "./RotationMatrix";
import { RotationBoard } from "./RotationBoard";
import { RotationDetail } from "./RotationDetail";
import { ThemeMembersDrawer } from "./ThemeMembersDrawer";
import { ROTATION_STATUS_LABELS, ROTATION_STATUS_COLORS_PANEL } from "./rotationStatus";

const KIND_OPTIONS = [
  { label: "Sectors", value: "sector" },
  { label: "Themes", value: "theme" },
  { label: "Industries", value: "industry" },
];

const PERIOD_OPTIONS: { label: string; value: RotationPeriod }[] = [
  "1D",
  "1W",
  "1M",
  "3M",
  "6M",
  "YTD",
  "1Y",
].map((period) => ({ label: period, value: period as RotationPeriod }));

const MIN_OPTIONS = [1, 3, 5, 10].map((value) => ({
  label: `≥ ${value}`,
  value: String(value),
}));

const STATUS_ORDER: RotationStatus[] = ["booming", "heating", "cooling", "dumping", "neutral"];

const KINDS: RotationKind[] = ["sector", "theme", "industry"];
const PERIODS: RotationPeriod[] = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y"];
const MIN_MEMBERS = [1, 3, 5, 10] as const;

function readEnum<T extends string>(key: string, allowed: T[], fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const value = new URLSearchParams(window.location.search).get(key);
  return value && allowed.includes(value as T) ? (value as T) : fallback;
}

function readNumber(key: string, allowed: readonly number[], fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const value = Number(new URLSearchParams(window.location.search).get(key));
  return allowed.includes(value) ? value : fallback;
}

function readGroup(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("group");
}

function writeParams(patch: Record<string, string | null>): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

// Inline Solid twins of src/hooks/useRotationUrlState and useRotationData —
// both are still React in hooks/ (another owner), so they cannot be imported.
function useRotationUrlState() {
  const [kind, setKindState] = createSignal<RotationKind>(readEnum("kind", KINDS, "sector"));
  const [period, setPeriodState] = createSignal<RotationPeriod>(readEnum("period", PERIODS, "1M"));
  const [minMembers, setMinMembersState] = createSignal<number>(readNumber("min", MIN_MEMBERS, 3));
  const [selectedId, setSelectedIdState] = createSignal<string | null>(readGroup());

  const setKind = (next: RotationKind) => {
    setKindState(next);
    setSelectedIdState(null);
    writeParams({ kind: next, group: null });
  };

  const setPeriod = (next: RotationPeriod) => {
    setPeriodState(next);
    writeParams({ period: next });
  };

  const setMinMembers = (next: number) => {
    const safe = MIN_MEMBERS.includes(next as (typeof MIN_MEMBERS)[number]) ? next : 3;
    setMinMembersState(safe);
    writeParams({ min: String(safe) });
  };

  const setSelectedId = (next: string | null) => {
    setSelectedIdState(next);
    writeParams({ group: next });
  };

  return { kind, period, minMembers, selectedId, setKind, setPeriod, setMinMembers, setSelectedId };
}

function useRotationData(market: () => "india" | "america", kind: () => RotationKind) {
  const [data, setData] = createSignal<RotationOverviewResponse | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [version, setVersion] = createSignal(0);

  createEffect(() => {
    const m = market();
    const k = kind();
    void version();
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    setLoading(true);
    setError(null);
    fetchRotationOverview({
      market: m,
      kind: k,
      minMembers: 1,
      limit: 48,
      signal: controller.signal,
    })
      .then((response) => {
        if (controller.signal.aborted) return;
        setData(response);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load rotation data");
        setData(null);
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setLoading(false);
      });
  });

  const refresh = () => setVersion((v) => v + 1);

  return { data, loading, error, refresh };
}

function Divider() {
  return <Box className="h-3 w-px shrink-0 bg-fin-border" />;
}

function StripLabel(props: { children: JSX.Element }) {
  return (
    <Text
      c="dimmed"
      className="text-[9.5px] font-bold tracking-[0.5px] uppercase"
    >
      {props.children}
    </Text>
  );
}

function regimeTone(label: string): string {
  const upper = label.toUpperCase();
  if (upper.includes("OFF")) return NEGATIVE;
  if (upper.includes("ON")) return POSITIVE;
  return WARNING;
}

export function RotationTab(props: { market: "india" | "america" }) {
  const market = () => props.market;
  const { kind, period, minMembers, selectedId, setKind, setPeriod, setMinMembers, setSelectedId } =
    useRotationUrlState();
  const { data, loading, error, refresh } = useRotationData(market, kind);

  const [membersRow, setMembersRow] = createSignal<RotationRow | null>(null);

  const visible = createMemo(() =>
    (data()?.rows ?? []).filter((row) => row.members >= minMembers()),
  );

  const selectedRow = createMemo(
    () => visible().find((row) => row.id === selectedId()) ?? visible()[0] ?? null,
  );

  const counts = createMemo(() => {
    const base: Record<RotationStatus, number> = {
      booming: 0,
      heating: 0,
      cooling: 0,
      dumping: 0,
      neutral: 0,
    };
    for (const row of visible()) base[row.status] += 1;
    return base;
  });

  const regime = () => data()?.regime ?? null;
  const updatedAt = () => (data()?.last_updated ? formatTimeOnly(data()!.last_updated!) : "");
  const selectedRowId = () => selectedRow()?.id ?? null;

  return (
    <Box
      data-testid="rotation-tab"
      className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-fin-bg"
    >
      <ToolbarRow
        gap={8}
        wrap={false}
        data-testid="rotation-toolbar"
        className="overflow-x-auto overflow-y-hidden"
        style={{
          padding: "0 10px",
          minHeight: 34,
          height: 34,
          borderBottom: "1px solid var(--color-fin-border)",
          flexShrink: 0,
        }}
      >
        <Text fw={700} className="text-[12px] whitespace-nowrap">
          Rotation
        </Text>
        <SegmentedControl
          value={kind()}
          onChange={(value) => setKind(value as RotationKind)}
          data={KIND_OPTIONS}
          size="xs"
          data-testid="rotation-kind"
        />
        <SegmentedControl
          value={period()}
          onChange={(value) => setPeriod(value as RotationPeriod)}
          data={PERIOD_OPTIONS}
          size="xs"
          data-testid="rotation-period"
        />
        <StripLabel>Min</StripLabel>
        <Select
          value={String(minMembers())}
          onChange={(value) => setMinMembers(Number(value ?? 1))}
          data={MIN_OPTIONS}
          size="xs"
          w={74}
          aria-label="Minimum members"
          data-testid="rotation-min-members"
        />
        <Box className="flex-1 min-w-[8px]" />
        <Show when={loading() && data()}>
          <Box className="flex items-center gap-1">
            <Loader size="xs" />
            <Text c="dimmed" className="text-[10px]">
              Updating
            </Text>
          </Box>
        </Show>
        <Show when={updatedAt()}>
          <Text c="dimmed" className="text-[10px] whitespace-nowrap font-mono tabular-nums">
            {updatedAt()}
          </Text>
        </Show>
        <ActionIcon
          variant="subtle"
          size="sm"
          aria-label="Refresh rotation data"
          onClick={refresh}
          data-testid="rotation-refresh"
        >
          <IconRefresh size={15} />
        </ActionIcon>
      </ToolbarRow>

      <Show when={regime()}>
        {(regimeAcc) => (
          <Box
            data-testid="rotation-regime"
            className="flex items-center gap-2 px-2 h-[26px] shrink-0 border-b border-fin-border overflow-hidden whitespace-nowrap"
          >
            <Box className="flex items-center gap-1 min-w-0">
              <StripLabel>{regimeAcc().benchmark}</StripLabel>
              <Text
                c={regimeAcc().benchmark_change >= 0 ? "success" : "error"}
                fw={600}
                className="text-[11px] tabular-nums font-mono"
              >
                {formatPercentage(regimeAcc().benchmark_change)}
              </Text>
            </Box>
            <Show when={regimeAcc().vix != null}>
              <>
                <Divider />
                <Box className="flex items-center gap-1">
                  <StripLabel>VIX</StripLabel>
                  <Text className="text-[11px] tabular-nums font-mono">
                    {regimeAcc().vix!.toFixed(2)}
                  </Text>
                  <Show when={regimeAcc().vix_change != null}>
                    <Text
                      c={regimeAcc().vix_change! <= 0 ? "success" : "error"}
                      fw={600}
                      className="text-[10.5px] tabular-nums font-mono"
                    >
                      {formatPercentage(regimeAcc().vix_change!)}
                    </Text>
                  </Show>
                </Box>
              </>
            </Show>
            <Divider />
            <Box className="flex items-center gap-1">
              <StripLabel>Breadth</StripLabel>
              <Text className="text-[11px] tabular-nums font-mono">
                {regimeAcc().breadth.toFixed(0)}%
              </Text>
            </Box>
            <Divider />
            <Box className="flex items-center gap-1">
              <Box
                className="size-[6px] rounded-full shrink-0"
                style={{ backgroundColor: regimeTone(regimeAcc().label) }}
              />
              <Text
                fw={700}
                className="text-[10px] tracking-[0.6px] uppercase"
                style={{ color: regimeTone(regimeAcc().label) }}
              >
                {regimeAcc().label}
              </Text>
            </Box>
            <Box className="flex-1" />
            <Box className="flex items-center gap-[10px]">
              <For each={STATUS_ORDER}>
                {(status) => (
                  <Box className="flex items-center gap-1">
                    <Box
                      className="size-[5px] rounded-full shrink-0"
                      style={{ backgroundColor: ROTATION_STATUS_COLORS_PANEL[status] }}
                    />
                    <Text c="dimmed" className="text-[9.5px] font-bold tracking-[0.3px]">
                      {ROTATION_STATUS_LABELS[status].short}
                    </Text>
                    <Text className="text-[10.5px] font-semibold tabular-nums font-mono">
                      {counts()[status]}
                    </Text>
                  </Box>
                )}
              </For>
            </Box>
          </Box>
        )}
      </Show>

      <Switch>
        <Match when={error()}>
          <Box
            data-testid="rotation-error"
            className="flex-1 min-h-0 flex items-center justify-center p-2"
          >
            <Box
              className="w-full max-w-[520px] flex flex-col gap-2"
            >
              <Alert color="error" title="Rotation data unavailable">
                {error()}
              </Alert>
              <Box>
                <Button variant="outline" size="xs" onClick={refresh}>
                  Retry
                </Button>
              </Box>
            </Box>
          </Box>
        </Match>
        <Match when={loading() || !data()}>
          <Box
            data-testid="rotation-loading"
            className="flex-1 min-h-0 flex items-center justify-center gap-2"
          >
            <Loader size="sm" />
            <Text size="xs" c="dimmed">
              Loading rotation…
            </Text>
          </Box>
        </Match>
        <Match when={visible().length === 0}>
          <Box
            data-testid="rotation-empty"
            className="flex-1 min-h-0 flex items-center justify-center p-2"
          >
            <Text size="xs" c="dimmed">
              No {kind()} groups with at least {minMembers()} members.
            </Text>
          </Box>
        </Match>
        <Match when={true}>
          <Box
            className="flex-1 min-h-0 grid gap-[2px] p-[2px] overflow-hidden grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] grid-rows-[auto_auto_auto_auto] lg:grid-rows-[minmax(0,1.18fr)_minmax(0,0.82fr)]"
          >
            <CompactPanel
              testId="rotation-rrg-panel"
              scrollable
              flush
              padded={false}
              className="min-h-[300px] lg:min-h-0"
              title={
                <Text className="text-[9.5px] font-bold uppercase tracking-[0.5px] text-fin-text-muted">
                  Relative rotation
                </Text>
              }
              description={
                <Text className="text-[9.5px] text-fin-text-muted">
                  RS 1M vs momentum · 50 = benchmark
                </Text>
              }
            >
              <RotationRrg
                rows={visible()}
                selectedId={selectedRowId()}
                onSelect={setSelectedId}
              />
            </CompactPanel>
            <CompactPanel
              testId="rotation-matrix-panel"
              scrollable
              flush
              padded={false}
              className="min-h-[260px] lg:min-h-0"
              title={
                <Text className="text-[9.5px] font-bold uppercase tracking-[0.5px] text-fin-text-muted">
                  Multi-period
                </Text>
              }
              description={<Text className="text-[9.5px] text-fin-text-muted">group returns</Text>}
            >
              <RotationMatrix
                rows={visible()}
                selectedId={selectedRowId()}
                onSelect={setSelectedId}
              />
            </CompactPanel>
            <CompactPanel
              testId="rotation-board-panel"
              scrollable
              flush
              padded={false}
              className="min-h-[320px] lg:min-h-0"
              title={
                <Text className="text-[9.5px] font-bold uppercase tracking-[0.5px] text-fin-text-muted">
                  Rotation board
                </Text>
              }
              description={<Text className="text-[9.5px] text-fin-text-muted">sorted by {period()}</Text>}
            >
              <RotationBoard
                rows={visible()}
                selectedId={selectedRowId()}
                onSelect={setSelectedId}
                period={period()}
              />
            </CompactPanel>
            <CompactPanel
              testId="rotation-detail-panel"
              scrollable
              flush
              padded={false}
              className="min-h-[200px] lg:min-h-0"
            >
              <RotationDetail row={selectedRow()} onOpenMembers={(row) => setMembersRow(row)} />
            </CompactPanel>
          </Box>
        </Match>
      </Switch>

      <ThemeMembersDrawer
        open={membersRow() !== null}
        slug={membersRow()?.slug ?? null}
        name={membersRow()?.name ?? ""}
        onClose={() => setMembersRow(null)}
      />
    </Box>
  );
}
