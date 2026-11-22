import { For, Show, createMemo } from "solid-js";
import { Badge, Box, Text } from "@/ui";
import { CompactPanel } from "@/components/common/compact";
import { EmptyState, ErrorAlert, InlineLoader } from "@/components/common/states";
import {
  AGRI_GROUPS,
  agriCommodityLabel,
  agriGroup,
  formatChangePct,
  type AgriGroupDescriptor,
} from "@/config/agri";
import { formatAgriSessionDate } from "./agriDates";

export type AgriCoverageTier = "A" | "B" | "C";

export interface AgriGroupMover {
  key: string;
  label?: string | null;
  chg_pct?: number | null;
}

export interface AgriGroupSeriesPoint {
  date: string;
  modal: number | null;
}

/**
 * One row of the category-first overview. `index` is the group price index
 * normalized to 100 at the start of the active window; `index_chg_pct` is the
 * move since that base (defaults to `index - 100`). A caller that only has a
 * group price series may omit `index` and pass `points`; the normalized index
 * is then derived from the first and last finite modal.
 *
 * Coverage is never invented: the tier is accepted when supplied and otherwise
 * derived from `mandis` / `coverage_pct` using the roadmap thresholds.
 */
export interface AgriGroupSummary {
  /** Registry key or group label; may be omitted when `key` carries it. */
  group?: string | null;
  /** Optional alias so a caller can pass a registry-shaped row directly. */
  key?: string | null;
  index?: number | null;
  index_chg_pct?: number | null;
  /** Group modal series; only used to derive `index` when it is absent. */
  points?: readonly AgriGroupSeriesPoint[] | null;
  /** % of the group's commodities with a positive change in the window. */
  breadth_pct?: number | null;
  /** Alias for `breadth_pct`; accepts either 0–1 or 0–100. */
  breadth?: number | null;
  up_count?: number | null;
  total_count?: number | null;
  median_volatility_pct?: number | null;
  /** Alias for `median_volatility_pct`. */
  volatility?: number | null;
  best?: AgriGroupMover | string | null;
  worst?: AgriGroupMover | string | null;
  tier?: AgriCoverageTier | string | null;
  /** Median mandis reporting per day, when available. */
  mandis?: number | null;
  coverage_pct?: number | null;
  as_of?: string | null;
}

export interface AgriGroupOverviewProps {
  groups?: readonly AgriGroupSummary[] | null;
  /** Page-level as-of; a card's own `as_of` wins when present. */
  asOf?: string | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onSelect?: (group: string) => void;
  selected?: string | null;
  className?: string;
  testId?: string;
  "data-testid"?: string;
}

export interface AgriCoverageInput {
  tier?: string | null;
  mandis?: number | null;
  coverage_pct?: number | null;
}

const TIER_RULES: Record<AgriCoverageTier, { title: string; description: string }> = {
  A: { title: "Tier A — broad sample", description: "≥100 mandis/day and ≥80% date coverage" },
  B: { title: "Tier B — moderate sample", description: "20–99 mandis/day" },
  C: { title: "Tier C — thin sample", description: "<20 mandis/day; rank claims need broader coverage" },
};

/** Shared label / value / trailing grid: every metric row lines up across cards. */
const METRIC_ROW = "grid grid-cols-[38px_minmax(0,1fr)_40px] items-center gap-x-1";
const MICRO_LABEL = "text-[9px] uppercase tracking-[0.06em]";

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampPct(value: number | null): number | null {
  if (value == null) return null;
  return Math.min(100, Math.max(0, value));
}

/** Accepts an explicit A/B/C first, then derives it from the measured sample. */
export function resolveCoverageTier(input: AgriCoverageInput): AgriCoverageTier | null {
  const supplied = typeof input.tier === "string" ? input.tier.trim().toUpperCase() : "";
  if (supplied === "A" || supplied === "B" || supplied === "C") return supplied;

  const mandis = finiteNumber(input.mandis);
  if (mandis == null) return null;
  const coverage = finiteNumber(input.coverage_pct);
  if (mandis >= 100) return coverage == null || coverage >= 80 ? "A" : "B";
  if (mandis >= 20) return "B";
  return "C";
}

export function coverageTierTone(tier: AgriCoverageTier | null): "success" | "warning" | "error" | "dimmed" {
  if (tier === "A") return "success";
  if (tier === "B") return "warning";
  if (tier === "C") return "error";
  return "dimmed";
}

export function coverageTierTitle(tier: AgriCoverageTier | null): string {
  return tier ? `${TIER_RULES[tier].title}: ${TIER_RULES[tier].description}` : "Coverage tier unavailable";
}

function breadthOf(item: AgriGroupSummary | null): number | null {
  if (!item) return null;
  const raw = finiteNumber(item.breadth_pct) ?? finiteNumber(item.breadth);
  if (raw != null) {
    // `AgriGroupSeries.breadth` is documented as either a fraction or a percent.
    return clampPct(Math.abs(raw) <= 1 && raw !== 0 ? raw * 100 : raw);
  }
  const up = finiteNumber(item.up_count);
  const total = finiteNumber(item.total_count);
  if (up == null || total == null || total <= 0) return null;
  return clampPct((up / total) * 100);
}

function indexOf(item: AgriGroupSummary | null): number | null {
  if (!item) return null;
  const direct = finiteNumber(item.index);
  if (direct != null) return direct;
  const points = Array.isArray(item.points) ? item.points : [];
  let first: number | null = null;
  let last: number | null = null;
  for (const point of points) {
    const value = finiteNumber(point?.modal);
    if (value == null) continue;
    if (first == null) first = value;
    last = value;
  }
  if (first == null || last == null || first === 0) return null;
  return (last / first) * 100;
}

function volatilityOf(item: AgriGroupSummary | null): number | null {
  if (!item) return null;
  return finiteNumber(item.median_volatility_pct) ?? finiteNumber(item.volatility);
}

function indexChangeOf(item: AgriGroupSummary | null): number | null {
  if (!item) return null;
  const explicit = finiteNumber(item.index_chg_pct);
  if (explicit != null) return explicit;
  const index = indexOf(item);
  return index == null ? null : index - 100;
}

function moverLabel(mover: AgriGroupMover | string | null | undefined): string {
  if (typeof mover === "string") return mover.trim() || "—";
  if (!mover) return "—";
  const key = typeof mover.key === "string" ? mover.key : "";
  const label = typeof mover.label === "string" ? mover.label.trim() : "";
  return label || agriCommodityLabel(key || null, key || "—");
}

function moverChange(mover: AgriGroupMover | string | null | undefined): number | null {
  if (typeof mover === "string") return null;
  return finiteNumber(mover?.chg_pct);
}

function moverTone(value: number | null): "success" | "error" | "dimmed" {
  if (value == null || value === 0) return "dimmed";
  return value > 0 ? "success" : "error";
}

function canonicalGroupKey(value: string | null | undefined): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const direct = agriGroup(value);
  if (direct) return direct.key;
  const lower = value.trim().toLowerCase();
  const byKey = agriGroup(lower);
  if (byKey) return byKey.key;
  return AGRI_GROUPS.find((group) => group.label.toLowerCase() === lower)?.key ?? "";
}

function groupKeyOf(item: AgriGroupSummary): string {
  return canonicalGroupKey(item.group) || canonicalGroupKey(item.key);
}

function GroupMoverLine(props: {
  kind: "best" | "worst";
  mover: AgriGroupMover | string | null | undefined;
  testId: string;
}): import("solid-js").JSX.Element {
  const change = () => moverChange(props.mover);
  return (
    <Box className={METRIC_ROW} data-testid={props.testId}>
      <Text size="xs" c="dimmed" className={MICRO_LABEL}>
        {props.kind === "best" ? "Best" : "Worst"}
      </Text>
      <Text size="xs" truncate className="min-w-0" title={moverLabel(props.mover)}>
        {moverLabel(props.mover)}
      </Text>
      <Text
        size="xs"
        c={moverTone(change())}
        className="justify-self-end font-mono tabular-nums text-[10px]"
      >
        {formatChangePct(change())}
      </Text>
    </Box>
  );
}

function GroupCard(props: {
  group: AgriGroupDescriptor;
  item: AgriGroupSummary | null;
  asOf: string | null;
  selected: boolean;
  onSelect?: (group: string) => void;
}) {
  const key = () => props.group.key;
  const index = () => indexOf(props.item);
  const change = () => indexChangeOf(props.item);
  const breadth = () => breadthOf(props.item);
  const tier = () =>
    resolveCoverageTier({
      tier: props.item?.tier,
      mandis: props.item?.mandis,
      coverage_pct: props.item?.coverage_pct,
    });

  const indexText = () => {
    const value = index();
    return value == null ? "—" : value.toFixed(1);
  };

  const changeTone = () => {
    const value = change();
    if (value == null || value === 0) return "dimmed";
    return value > 0 ? "success" : "error";
  };

  const breadthTone = () => {
    const value = breadth();
    if (value == null || value === 50) return "dimmed";
    return value > 50 ? "success" : "error";
  };

  const breadthColour = () => {
    const value = breadth();
    if (value == null || value === 50) return "var(--color-fin-text-muted)";
    return value > 50 ? "var(--color-fin-positive)" : "var(--color-fin-negative)";
  };

  const breadthTitle = () => {
    const value = breadth();
    if (value == null) return "Breadth unavailable";
    const up = finiteNumber(props.item?.up_count);
    const total = finiteNumber(props.item?.total_count);
    return up != null && total != null
      ? `${Math.round(up)} of ${Math.round(total)} commodities up`
      : `${Math.round(value)}% of commodities up`;
  };

  const coverageText = () => {
    const parts: string[] = [];
    const mandis = finiteNumber(props.item?.mandis);
    const coverage = finiteNumber(props.item?.coverage_pct);
    const volatility = volatilityOf(props.item);
    if (mandis != null) parts.push(`${Math.round(mandis)} mandis`);
    if (coverage != null) parts.push(`${Math.round(coverage)}% cov`);
    if (volatility != null) parts.push(`${volatility.toFixed(1)}% vol`);
    return parts.length > 0 ? parts.join(" · ") : "coverage —";
  };

  const asOfText = () =>
    formatAgriSessionDate(
      (typeof props.item?.as_of === "string" && props.item.as_of) || props.asOf,
    );

  return (
    <Box
      component={props.onSelect ? "button" : "div"}
      type={props.onSelect ? "button" : undefined}
      data-testid={`agri-group-card-${key()}`}
      data-group={key()}
      data-selected={props.selected ? "true" : "false"}
      aria-pressed={props.onSelect ? (props.selected ? "true" : "false") : undefined}
      aria-label={`${props.group.label} group overview`}
      title={
        tier()
          ? `${props.group.label} · ${coverageTierTitle(tier())}`
          : `${props.group.label} group overview`
      }
      onClick={props.onSelect ? () => props.onSelect?.(key()) : undefined}
      className={[
        "flex min-w-0 flex-col gap-1 rounded-[4px] border bg-fin-surface p-2 text-left",
        props.selected ? "border-fin-primary" : "border-fin-border",
        props.onSelect
          ? "cursor-pointer hover:bg-fin-surface-alt focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fin-primary"
          : "",
      ].join(" ")}
    >
      <Box className="flex min-w-0 items-center justify-between gap-1">
        <Text size="xs" fw={700} truncate className="min-w-0" title={props.group.label}>
          {props.group.label}
        </Text>
        <Badge
          size="xs"
          color={coverageTierTone(tier())}
          title={coverageTierTitle(tier())}
          data-testid={`agri-group-tier-${key()}`}
        >
          {tier() ? `Tier ${tier()}` : "Tier —"}
        </Badge>
      </Box>

      <Box className="min-w-0">
        <Box className={METRIC_ROW}>
          <Text size="xs" c="dimmed" className={MICRO_LABEL}>
            Index
          </Text>
          <Text
            fw={700}
            className="font-mono tabular-nums leading-none text-[20px]"
            data-testid={`agri-group-index-${key()}`}
          >
            {indexText()}
          </Text>
          <Show when={change() != null}>
            <Text
              size="xs"
              c={changeTone()}
              className="justify-self-end font-mono tabular-nums text-[10px]"
              data-testid={`agri-group-change-${key()}`}
              title="Change since the 100 base at the window start"
            >
              {formatChangePct(change())}
            </Text>
          </Show>
        </Box>
        <Box className="mt-0.5 flex min-w-0 items-center justify-between gap-1">
          <Text size="xs" c="dimmed" className={MICRO_LABEL}>
            100 base
          </Text>
          <Show when={tier() === "C"}>
            <Badge size="xs" color="error" data-testid={`agri-group-thin-${key()}`}>
              thin sample
            </Badge>
          </Show>
        </Box>
      </Box>

      <Box className="min-w-0">
        <Box className={METRIC_ROW}>
          <Text size="xs" c="dimmed" className={MICRO_LABEL}>
            Breadth
          </Text>
          <Text
            size="xs"
            c={breadthTone()}
            className="col-start-3 justify-self-end font-mono tabular-nums text-[10px]"
            title={breadthTitle()}
            data-testid={`agri-group-breadth-${key()}`}
          >
            {breadth() == null ? "—" : `${Math.round(breadth() as number)}%`}
          </Text>
        </Box>
        <Box
          className="mt-0.5 h-[3px] w-full overflow-hidden rounded-[2px] bg-fin-surface-alt"
          aria-hidden="true"
        >
          <Box
            className="h-full"
            data-testid={`agri-group-breadth-bar-${key()}`}
            data-value={breadth() ?? ""}
            style={{ width: `${breadth() ?? 0}%`, "background-color": breadthColour() }}
          />
        </Box>
      </Box>

      <Box className="flex min-w-0 flex-col gap-0.5">
        <GroupMoverLine
          kind="best"
          mover={props.item?.best}
          testId={`agri-group-best-${key()}`}
        />
        <GroupMoverLine
          kind="worst"
          mover={props.item?.worst}
          testId={`agri-group-worst-${key()}`}
        />
      </Box>

      <Box
        className="flex min-w-0 items-center justify-between gap-1 border-t border-fin-border pt-1"
        title={`${coverageTierTitle(tier())} · ${coverageText()}`}
      >
        <Text
          size="xs"
          c="dimmed"
          truncate
          className="min-w-0 text-[9px]"
          data-testid={`agri-group-coverage-${key()}`}
        >
          {coverageText()}
        </Text>
        <Text
          size="xs"
          c="dimmed"
          className="shrink-0 whitespace-nowrap text-[9px]"
          data-testid={`agri-group-asof-${key()}`}
        >
          {asOfText()}
        </Text>
      </Box>
    </Box>
  );
}

export function AgriGroupOverview(props: AgriGroupOverviewProps) {
  const testId = () => props.testId ?? props["data-testid"] ?? "agri-group-overview";

  const cards = createMemo(() => {
    const source = Array.isArray(props.groups) ? props.groups : [];
    const byGroup = new Map<string, AgriGroupSummary>();
    for (const item of source) {
      if (!item || typeof item !== "object") continue;
      const key = groupKeyOf(item);
      if (key && !byGroup.has(key)) byGroup.set(key, item);
    }
    return AGRI_GROUPS.map((group) => ({
      group,
      item: byGroup.get(group.key) ?? null,
    }));
  });

  const hasAnyData = () => cards().some((card) => card.item != null);
  const loadingWithoutData = () => !!props.loading && !hasAnyData();

  const asOf = () => {
    if (props.asOf) return props.asOf;
    for (const card of cards()) {
      if (typeof card.item?.as_of === "string" && card.item.as_of) return card.item.as_of;
    }
    return null;
  };

  const description = () =>
    `Index 100 at window start · breadth = % commodities up · as of ${formatAgriSessionDate(asOf())}`;

  return (
    <CompactPanel
      testId={testId()}
      title="Group overview"
      description={description()}
      action={
        props.loading && hasAnyData() ? (
          <Badge size="xs" color="primary">
            Updating
          </Badge>
        ) : undefined
      }
      className={["shrink-0", props.className].filter(Boolean).join(" ")}
    >
      <Show when={props.error}>
        {(message) => (
          <Box className="mb-1">
            <ErrorAlert
              message={message()}
              withRetry={!!props.onRetry}
              onRetry={props.onRetry}
              data-testid="agri-group-overview-error"
            />
          </Box>
        )}
      </Show>

      <Show
        when={!loadingWithoutData()}
        fallback={
          <InlineLoader
            data-testid="agri-group-overview-loading"
            message="Loading group aggregates…"
          />
        }
      >
        <Box
          className="grid grid-cols-1 gap-1 min-[360px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
          data-testid="agri-group-overview-grid"
        >
          <For each={cards()}>
            {(card) => (
              <GroupCard
                group={card.group}
                item={card.item}
                asOf={asOf()}
                selected={!!props.selected && props.selected === card.group.key}
                onSelect={props.onSelect}
              />
            )}
          </For>
        </Box>

        <Show when={!props.loading && !props.error && !hasAnyData()}>
          <Box className="mt-1">
            <EmptyState
              kind="no-data"
              layout="row"
              title="No group aggregates yet"
              description="Waiting for the next agri snapshot; the five groups are ready and will fill in as data arrives."
              data-testid="agri-group-overview-empty"
            />
          </Box>
        </Show>
      </Show>
    </CompactPanel>
  );
}
