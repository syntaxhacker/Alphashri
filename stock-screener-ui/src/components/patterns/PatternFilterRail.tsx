import { createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { Box, Button, Chip, Divider, MultiSelect, Select, Switch, Text, TextInput, ToolbarRow, Tooltip } from "@/ui";
import { CompactPanel } from "@/components/common/compact";
import { IconX, IconRestore } from "@/patterns/icons";
import type {
  PatternDef,
  PatternFilters,
  PatternHitDTO,
  PatternSummary,
  TrendlinesView,
} from "@/types/chartPatterns";
import {
  PATTERN_FAMILIES,
  PATTERN_LABELS,
  QUALITY_INFO,
} from "@/config/patternCatalog";
import { FAMILY_LABELS } from "./shared";
import { PatternPresets } from "./PatternPresets";
import { FilterNumber } from "./FilterNumber";
import { PatternImage } from "./PatternImage";
import { ReplayScanControl, type ReplayScanArgs } from "./ReplayScanControl";
import { daysAgoDatetimeLocal, startOfMonthDatetimeLocal } from "./datetime";
import { DEFAULT_PATTERN_FILTERS } from "@/state/chartPatterns";
import { cn } from "@/ui/cn";

const FAMILY_ORDER = ["reversal", "continuation", "curve_cup"];
const FORMED_PRESETS = [1, 3, 5, 10, 20, 30, 60];
/** Consolidation base-length presets (days); `Any` clears the bound. */
const BASE_LENGTH_PRESETS = [30, 60, 90, 120, 180];

export interface PatternFilterRailProps {
  patterns: PatternDef[];
  results: PatternHitDTO[];
  /** Aggregate counts for the whole filtered set (chips prefer these over `props.results`). */
  summary?: PatternSummary | null;
  filters: PatternFilters;
  setFilter: (key: string, value: any) => void;
  resetFilters: () => void;
  /** Apply a partial filter patch (merged onto defaults) and reload; used by presets. */
  applyFilters: (filters: Partial<PatternFilters>) => void;
  /** Map of `pattern_id` → reference-image URL (from `fetchPatternImages`). */
  images?: Record<string, string>;
  /**
   * `"rail"` (default) = single vertical column. `"panel"` = explicit 3-column
   * layout for the filter modal (What · Patterns · Refine), top-aligned.
   */
  layout?: "rail" | "panel";
  /** Run an as-of replay scan; renders the replay control when provided. */
  onReplayScan?: (args: ReplayScanArgs) => void;
}

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Section header: 10px, uppercase, muted, tracking-[0.06em]. */
function Section(props: {
  title: string;
  info?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <Box className="flex min-w-0 flex-col gap-1">
      <Box className="flex items-center gap-1">
        <Text c="dimmed" className="text-[10px] font-semibold uppercase tracking-[0.06em]">
          {props.title}
        </Text>
        {props.info}
      </Box>
      {props.children}
    </Box>
  );
}

/** Compact `?` help affordance listing a set of `{label, description}` entries. */
function InfoTip(props: {
  title: string;
  items: Array<{ label: string; description: string }>;
  testId: string;
}) {
  return (
    <Tooltip
      position="top"
      multiline
      withArrow
      label={
        <Box className="flex max-w-[260px] flex-col gap-1">
          <Text size="xs" fw={700}>
            {props.title}
          </Text>
          <For each={props.items}>
            {(item) => (
              <Text size="xs">
                <strong>{item.label}</strong>: {item.description}
              </Text>
            )}
          </For>
        </Box>
      }
    >
      <Text
        size="xs"
        c="dimmed"
        style={{ cursor: "help", "user-select": "none", "line-height": 1 }}
        data-testid={props.testId}
      >
        ⓘ
      </Text>
    </Tooltip>
  );
}

function infoItems(
  info: Record<string, { label: string; description: string }>,
): Array<{ label: string; description: string }> {
  return Object.values(info).map((entry) => ({ label: entry.label, description: entry.description }));
}

/** Filter controls: family, patterns, direction, status, quality, formed-within, volume. */
export function PatternFilterRail(props: PatternFilterRailProps) {
  const panel = () => (props.layout ?? "rail") === "panel";
  // Compact pattern picker state (panel layout). Search + hide-zero keep the
  // gallery scannable without forcing a long scroll past empty patterns.
  const [patternQuery, setPatternQuery] = createSignal("");
  // A user who arrives with advanced filters already applied must see them,
  // not a collapsed section that silently hides the active constraints.
  const advancedActive = () =>
    props.filters.min_confidence != null ||
    props.filters.min_breakout_score != null ||
    props.filters.min_rel_volume != null ||
    props.filters.min_volume_m != null ||
    (props.filters.min_avg_volume_10d != null &&
      props.filters.min_avg_volume_10d !== DEFAULT_PATTERN_FILTERS.min_avg_volume_10d) ||
    (props.filters.trendlines ?? "both") !== "both";
  const [advancedOpen, setAdvancedOpen] = createSignal(advancedActive());
  const [hideZero, setHideZero] = createSignal(false);
  // One pass over the props.results feeds both family and pattern counters; the old
  // code re-scanned `props.results` once per family on every render.
  const counts = createMemo(() => {
    const familyMap = new Map<string, number>();
    const patternMap = new Map<string, number>();
    for (const result of props.results) {
      familyMap.set(result.family, (familyMap.get(result.family) ?? 0) + 1);
      patternMap.set(result.pattern_id, (patternMap.get(result.pattern_id) ?? 0) + 1);
    }
    return { familyCounts: familyMap, patternCounts: patternMap };
  });

  const families = createMemo(() => {
    const order = Array.from(new Set([...FAMILY_ORDER, ...props.patterns.map((p) => p.family)]));
    return order.map((id) => ({
      id,
      label: FAMILY_LABELS[id] ?? id,
      count: props.summary?.family_counts?.[id] ?? counts().familyCounts.get(id) ?? 0,
    }));
  });

  const selectedFamilies = () => asArray(props.filters.family);
  const selectedPatterns = () => asArray(props.filters.pattern_id);
  const selectedDirections = () => asArray(props.filters.direction);
  const selectedStatuses = () => asArray(props.filters.status);
  const formedWithin = () => props.filters.formed_within_bars ?? null;
  const minBaseDays = () => props.filters.min_base_days ?? null;
  const sort = () => props.filters.sort ?? "confidence";

  const patternCountFor = (patternId: string): number =>
    props.summary?.pattern_counts?.[patternId] ?? counts().patternCounts.get(patternId) ?? 0;

  // The gallery only depends on the query, the zero filter and the counters —
  // not on unrelated filter changes or typing in other inputs.
  const query = createMemo(() => patternQuery().trim().toLowerCase());
  const gallery = createMemo(() =>
    PATTERN_FAMILIES.map((family) => ({
      family,
      visible: family.patterns.filter((pattern) => {
        if (hideZero() && patternCountFor(pattern.id) === 0) return false;
        if (!query()) return true;
        const label = PATTERN_LABELS[pattern.id] ?? pattern.name;
        return label.toLowerCase().includes(query());
      }),
    })).filter((group) => group.visible.length > 0),
  );

  const presetsSection = (
    <Section title="Presets">
      <PatternPresets filters={props.filters} applyFilters={props.applyFilters} />
    </Section>
  );

  const familySection = (
    <Section title="Pattern family">
      <Box
        data-testid="patterns-family-select"
        title={
          selectedFamilies().length
            ? selectedFamilies()
                .map((id) => families().find((f) => f.id === id)?.label ?? id)
                .join(", ")
            : undefined
        }
      >
        <MultiSelect
          data={families().map((f) => ({ value: f.id, label: `${f.label} (${f.count})` }))}
          value={selectedFamilies()}
          onChange={(vals) => props.setFilter("family", vals)}
          size="xs"
          placeholder={
            selectedFamilies().length ? `${selectedFamilies().length} selected` : "Any family"
          }
          clearable
          hideTags
        />
      </Box>
    </Section>
  );

  const PatternTile = (tileProps: { patternId: string; label: string; count: number }) => {
    const selected = () => selectedPatterns().includes(tileProps.patternId);
    const togglePattern = () =>
      props.setFilter("pattern_id", toggle(selectedPatterns(), tileProps.patternId));
    return (
      <button
        type="button"
        aria-pressed={selected()}
        onClick={togglePattern}
        data-testid={`patterns-filter-pattern-${tileProps.patternId}`}
        className={cn(
          "flex min-w-0 cursor-pointer items-center gap-[3px] rounded-fin border px-1 py-[2px] transition-[border-color,background-color] duration-[120ms]",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fin-primary",
          selected()
            ? "border-fin-primary bg-fin-primary/12"
            : "border-fin-border bg-transparent hover:border-fin-primary hover:bg-fin-surface-alt",
        )}
      >
        <Box
          aria-hidden="true"
          className="h-[14px] w-6 shrink-0 overflow-hidden rounded-sm"
        >
          <PatternImage
            patternId={tileProps.patternId}
            images={props.images ?? {}}
            height={14}
            showPlaceholderLabel={false}
          />
        </Box>
        <Box className="flex min-w-0 flex-1 items-baseline">
          <Text
            size="xs"
            fw={selected() ? 700 : 500}
            truncate
            className="min-w-0 leading-[1.2]"
          >
            {tileProps.label}
          </Text>
          <Text
            size="xs"
            c={tileProps.count > 0 ? "text.secondary" : "dimmed"}
            style={{ "font-variant-numeric": "tabular-nums", "white-space": "nowrap", "padding-left": "3px" }}
          >
            {` (${tileProps.count})`}
          </Text>
        </Box>
      </button>
    );
  };

  const patternsSection = (
    <Section title="Patterns">
      <Box className="flex flex-col gap-2">
        <ToolbarRow gap={6}>
          <Box className="min-w-0 flex-1">
            <TextInput
              value={patternQuery()}
              onChange={(value) => setPatternQuery(String(value ?? ""))}
              placeholder="Find a pattern…"
              size="xs"
              data-testid="patterns-filter-search"
              style={{ width: "100%" }}
            />
          </Box>
          <Switch
            label="Hide 0"
            size="xs"
            checked={hideZero()}
            onChange={(e) => setHideZero((e.currentTarget as HTMLInputElement).checked)}
            data-testid="patterns-filter-hide-zero"
          />
        </ToolbarRow>
        <Show when={selectedPatterns().length >= 2}>
          <Switch
            label="Match in order (sequence)"
            size="xs"
            checked={Boolean(props.filters.sequence)}
            onChange={(e) => props.setFilter("sequence", (e.currentTarget as HTMLInputElement).checked)}
            data-testid="patterns-filter-sequence"
          />
        </Show>
        <Show when={props.filters.sequence && selectedPatterns().length >= 2}>
          <Box className="flex flex-col gap-1">
            <ToolbarRow gap={6} wrap>
              <Text size="xs" c="dimmed">Max gap</Text>
              <Select
                data={[
                  { value: "5", label: "5d" },
                  { value: "10", label: "10d" },
                  { value: "20", label: "20d" },
                  { value: "40", label: "40d" },
                  { value: "any", label: "Any" },
                ]}
                value={props.filters.sequence_gap_days == null ? "any" : String(props.filters.sequence_gap_days)}
                onChange={(v) => props.setFilter("sequence_gap_days", v === "any" ? null : Number(v))}
                size="xs"
                data-testid="patterns-filter-sequence-gap"
              />
              <Text size="xs" c="dimmed">Last step ≤</Text>
              <Select
                data={[
                  { value: "1", label: "1 bar" },
                  { value: "3", label: "3 bars" },
                  { value: "5", label: "5 bars" },
                  { value: "10", label: "10 bars" },
                  { value: "any", label: "Any" },
                ]}
                value={props.filters.sequence_max_bars == null ? "any" : String(props.filters.sequence_max_bars)}
                onChange={(v) => props.setFilter("sequence_max_bars", v === "any" ? null : Number(v))}
                size="xs"
                data-testid="patterns-filter-sequence-bars"
              />
            </ToolbarRow>
            <ToolbarRow gap={4}>
              <Text size="xs" c="dimmed">Earlier steps</Text>
              <For each={["confirmed", "forming"]}>
                {(status) => {
                  const active = () => (props.filters.sequence_step_status ?? []).includes(status);
                  return (
                    <Chip
                      size="xs"
                      variant="light"
                      checked={active()}
                      onChange={() => {
                        const current = props.filters.sequence_step_status ?? [];
                        props.setFilter(
                          "sequence_step_status",
                          active() ? current.filter((x) => x !== status) : [...current, status],
                        );
                      }}
                      data-testid={`patterns-filter-sequence-status-${status}`}
                    >
                      {status === "confirmed" ? "Confirmed" : "Forming"}
                    </Chip>
                  );
                }}
              </For>
            </ToolbarRow>
          </Box>
        </Show>
        <Show when={selectedPatterns().length > 0}>
          <ToolbarRow gap={4}>
            <Text size="xs" c="dimmed">
              {`${selectedPatterns().length} selected`}
            </Text>
            <Tooltip label="Clear selected patterns">
              <button
                type="button"
                aria-label="Clear patterns"
                onClick={() => props.setFilter("pattern_id", [])}
                data-testid="patterns-filter-pattern-clear"
                className="inline-flex size-5 items-center justify-center rounded text-fin-text-muted transition-colors hover:bg-fin-surface-alt hover:text-fin-text"
              >
                <IconX size={14} />
              </button>
            </Tooltip>
          </ToolbarRow>
        </Show>
        <Box
          className="flex max-h-[340px] flex-col gap-1 overflow-y-auto pr-1"
        >
        <For each={gallery()}>
          {({ family, visible }) => (
            <Box
              className="flex flex-col gap-0.5"
              data-testid={`patterns-filter-family-group-${family.id}`}
            >
              <Text size="xs" c="dimmed" fw={600} style={{ "font-size": "10px" }}>
                {family.label}
              </Text>
              <Box
                className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-0.5"
              >
                <For each={visible}>
                  {(pattern) => (
                    <PatternTile
                      patternId={pattern.id}
                      label={PATTERN_LABELS[pattern.id] ?? pattern.name}
                      count={patternCountFor(pattern.id)}
                    />
                  )}
                </For>
              </Box>
            </Box>
          )}
        </For>
        </Box>
      </Box>
    </Section>
  );

  const directionSection = (
    <Section title="Direction">
      <Box data-testid="patterns-direction-select">
        <MultiSelect
          data={[
            { value: "bullish", label: "Bullish" },
            { value: "bearish", label: "Bearish" },
          ]}
          value={selectedDirections()}
          onChange={(vals) => props.setFilter("direction", vals)}
          size="xs"
          placeholder={
            selectedDirections().length ? `${selectedDirections().length} selected` : "Any direction"
          }
          clearable
          hideTags
        />
      </Box>
    </Section>
  );

  const statusSection = (
    <Section title="Status">
      <Box data-testid="patterns-status-select">
        <MultiSelect
          data={["forming", "confirmed", "failed", "marginal"].map((status) => ({
            value: status,
            label: status.charAt(0).toUpperCase() + status.slice(1),
          }))}
          value={selectedStatuses()}
          onChange={(vals) => props.setFilter("status", vals)}
          size="xs"
          placeholder={
            selectedStatuses().length ? `${selectedStatuses().length} selected` : "Any status"
          }
          clearable
          hideTags
        />
      </Box>
    </Section>
  );

  const qualitySection = (
    <Section
      title="Shape quality"
      info={
        <InfoTip
          title="Shape quality"
          items={infoItems(QUALITY_INFO)}
          testId="patterns-quality-info"
        />
      }
    >
      <Select
        data={[
          { value: "any", label: "Any" },
          { value: "fair", label: "Fair+" },
          { value: "strong", label: "Strong+" },
          { value: "textbook", label: "Textbook" },
        ]}
        value={props.filters.quality ?? "any"}
        onChange={(v) => props.setFilter("quality", v && v !== "any" ? v : null)}
        size="xs"
        data-testid="patterns-quality-select"
      />
    </Section>
  );

  const formedSection = (
    <Section title="Formed within (bars)">
      <Box data-testid="patterns-filter-formed-within">
        <Select
          data={[
            { value: "any", label: "Any" },
            ...FORMED_PRESETS.map((n) => ({ value: String(n), label: String(n) })),
          ]}
          value={formedWithin() == null ? "any" : String(formedWithin())}
          onChange={(v) => props.setFilter("formed_within_bars", v === "any" ? null : Number(v))}
          size="xs"
          data-testid="patterns-filter-formed-within-select"
        />
      </Box>
    </Section>
  );

  const dateSection = (
    <Section title="Formed between">
      <Box className="flex flex-col gap-2">
        <Box className="flex flex-col gap-1">
          <Text size="xs" c="dimmed">
            From
          </Text>
          <ToolbarRow gap={4}>
            <TextInput
              type="datetime-local"
              value={props.filters.from_date ?? ""}
              onChange={(v) => props.setFilter("from_date", v ? String(v) : null)}
              size="xs"
              w={190}
              data-testid="patterns-filter-from-date"
            />
            <Show when={props.filters.from_date}>
              <Button
                size="xs"
                variant="subtle"
                onClick={() => props.setFilter("from_date", null)}
                data-testid="patterns-filter-from-date-clear"
              >
                Clear
              </Button>
            </Show>
          </ToolbarRow>
        </Box>
        <Box className="flex flex-col gap-1">
          <Text size="xs" c="dimmed">
            To
          </Text>
          <ToolbarRow gap={4}>
            <TextInput
              type="datetime-local"
              value={props.filters.to_date ?? ""}
              onChange={(v) => props.setFilter("to_date", v ? String(v) : null)}
              size="xs"
              w={190}
              data-testid="patterns-filter-to-date"
            />
            <Show when={props.filters.to_date}>
              <Button
                size="xs"
                variant="subtle"
                onClick={() => props.setFilter("to_date", null)}
                data-testid="patterns-filter-to-date-clear"
              >
                Clear
              </Button>
            </Show>
          </ToolbarRow>
        </Box>
        <Box className="flex flex-wrap gap-1">
          <Chip
            size="xs"
            variant="light"
            onChange={() => props.setFilter("from_date", daysAgoDatetimeLocal(30))}
            data-testid="patterns-filter-date-last-30d"
          >
            Last 30 days
          </Chip>
          <Chip
            size="xs"
            variant="light"
            onChange={() => props.setFilter("from_date", startOfMonthDatetimeLocal())}
            data-testid="patterns-filter-date-this-month"
          >
            This month
          </Chip>
        </Box>
      </Box>
    </Section>
  );

  const replaySection = props.onReplayScan ? (
    <Section title="Replay scan">
      <ReplayScanControl onReplayScan={props.onReplayScan} />
    </Section>
  ) : null;

  const sortSection = (
    <Section title="Sort">
      <Box data-testid="patterns-filter-sort">
        <Select
          data={[
            { value: "confidence", label: "Confidence" },
            { value: "newest", label: "Latest formed" },
            { value: "range_pos", label: "Near breakout" },
            { value: "distance", label: "Closest to trigger" },
          ]}
          value={sort()}
          onChange={(v) => props.setFilter("sort", v)}
          size="xs"
          data-testid="patterns-filter-sort-select"
        />
      </Box>
    </Section>
  );

  const historySection = (
    <Section
      title="Patterns per symbol"
      info={
        <InfoTip
          title="Patterns per symbol"
          items={[
            { label: "1", description: "Latest pattern only — the compact view." },
            { label: "3 / 5", description: "Show the last few patterns for each symbol." },
            {
              label: "Overlap",
              description:
                "The same pattern re-detected is collapsed to its newest instance; different patterns are kept even when their spans overlap.",
            },
          ]}
          testId="patterns-history-info"
        />
      }
    >
      <ToolbarRow gap={4} data-testid="patterns-filter-history">
        <For each={[1, 3, 5]}>
          {(n) => (
            <Chip
              size="xs"
              variant="light"
              checked={(props.filters.history ?? 1) === n}
              onChange={() => props.setFilter("history", n)}
              data-testid={`patterns-filter-history-${n}`}
            >
              {n}
            </Chip>
          )}
        </For>
      </ToolbarRow>
    </Section>
  );

  const baseSection = (
    <Section title="Base length (days)">
      <Box data-testid="patterns-filter-min-base">
        <Select
          data={[
            { value: "any", label: "Any" },
            ...BASE_LENGTH_PRESETS.map((n) => ({ value: String(n), label: String(n) })),
          ]}
          value={minBaseDays() == null ? "any" : String(minBaseDays())}
          onChange={(v) => props.setFilter("min_base_days", v === "any" ? null : Number(v))}
          size="xs"
          data-testid="patterns-filter-min-base-select"
        />
      </Box>
    </Section>
  );

  const rangeSection = (
    <Section title="Range ≤ %">
      <FilterNumber
        value={props.filters.max_range_pct}
        onChange={(v) => props.setFilter("max_range_pct", v)}
        min={0}
        step={1}
        testId="patterns-filter-max-range"
      />
    </Section>
  );

  const gap52Section = (
    <Section title="52W gap ≤ %">
      <FilterNumber
        value={props.filters.max_52w_gap}
        onChange={(v) => props.setFilter("max_52w_gap", v)}
        min={0}
        max={25}
        step={0.5}
        testId="patterns-filter-max-52w-gap"
      />
    </Section>
  );

  const rangePosSection = (
    <Section title="Range pos ≥ %">
      <FilterNumber
        value={props.filters.min_range_pos}
        onChange={(v) => props.setFilter("min_range_pos", v)}
        min={0}
        max={100}
        step={5}
        testId="patterns-filter-min-range-pos"
      />
    </Section>
  );

  // Result-level client-side floors (filtered in the store selector, never sent
  // to the API): pattern-fit confidence and breakout conviction.
  const scoreSection = (
    <Section title="Score ≥">
      <FilterNumber
        value={props.filters.min_confidence}
        onChange={(v) => props.setFilter("min_confidence", v)}
        min={0}
        max={100}
        step={5}
        testId="patterns-filter-min-confidence"
      />
    </Section>
  );

  const breakoutSection = (
    <Section title="Breakout ≥">
      <FilterNumber
        value={props.filters.min_breakout_score}
        onChange={(v) => props.setFilter("min_breakout_score", v)}
        min={0}
        max={100}
        step={5}
        testId="patterns-filter-min-breakout"
      />
    </Section>
  );

  // Scan-time volume pre-filters: the scan pre-filters the universe via
  // TradingView before fetching candles (unlike the result-level filters).
  const relVolumeField = (
    <Section title="Rel vol ≥">
      <FilterNumber
        value={props.filters.min_rel_volume}
        onChange={(v) => props.setFilter("min_rel_volume", v)}
        min={0}
        max={10}
        step={0.5}
        testId="patterns-filter-min-rel-volume"
      />
    </Section>
  );

  const volumeMField = (
    <Section title="Volume ≥ M">
      <FilterNumber
        value={props.filters.min_volume_m}
        onChange={(v) => props.setFilter("min_volume_m", v)}
        min={0}
        max={500}
        step={5}
        testId="patterns-filter-min-volume-m"
      />
    </Section>
  );

  const avgVolume10dField = (
    <Section title="10d avg vol ≥ K">
      <FilterNumber
        value={props.filters.min_avg_volume_10d}
        onChange={(v) => props.setFilter("min_avg_volume_10d", v)}
        min={0}
        max={500000}
        step={50}
        testId="patterns-filter-min-avg-volume-10d"
      />
    </Section>
  );

  // View-only overlay toggle: controls which standalone support/resistance
  // lines are drawn on the card/fullscreen charts. Never sent to the API.
  const trendlinesSection = (
    <Section title="Trendlines">
      <Select
        data={[
          { value: "both", label: "Both" },
          { value: "support", label: "TLS only" },
          { value: "resistance", label: "TLR only" },
          { value: "none", label: "None" },
        ]}
        value={props.filters.trendlines ?? "both"}
        onChange={(v) => props.setFilter("trendlines", (v ?? "both") as TrendlinesView)}
        size="xs"
        data-testid="patterns-filter-trendlines"
      />
    </Section>
  );

  const volumeSection = (
    <Box className="flex items-center justify-between gap-2">
      <Switch
        label="Volume confirmed"
        size="xs"
        checked={Boolean(props.filters.volume_confirmed)}
        onChange={(e) => props.setFilter("volume_confirmed", (e.currentTarget as HTMLInputElement).checked ? true : null)}
        data-testid="patterns-volume-confirmed"
      />
      <Show when={!panel()}>
        <Tooltip label="Reset all filters">
          <button
            type="button"
            aria-label="Reset filters"
            onClick={props.resetFilters}
            data-testid="patterns-reset"
            className="inline-flex size-6 items-center justify-center rounded border border-fin-border bg-transparent text-fin-text-muted transition-colors hover:bg-fin-surface-alt hover:text-fin-text"
          >
            <IconRestore size={14} />
          </button>
        </Tooltip>
      </Show>
    </Box>
  );

  const railContent = (
    <>
      {/* Pattern: presets · family · gallery */}
      <Box className="flex min-w-0 flex-col gap-1">
        {presetsSection}
        {familySection}
        {patternsSection}
      </Box>
      <Divider />
      {/* Direction/Quality */}
      <Box className="flex min-w-0 flex-col gap-1">
        {directionSection}
        {statusSection}
        {qualitySection}
      </Box>
      <Divider />
      {/* Score/Range */}
      <Box className="flex min-w-0 flex-col gap-1">
        {formedSection}
        {dateSection}
        {sortSection}
        {historySection}
        {baseSection}
        {rangeSection}
        {gap52Section}
        {rangePosSection}
        {scoreSection}
        {breakoutSection}
        <Section title="Volume scan">
          <Box className="grid grid-cols-3 gap-2">
            {relVolumeField}
            {volumeMField}
            {avgVolume10dField}
          </Box>
        </Section>
        {replaySection}
        {volumeSection}
      </Box>
      <Divider />
      {/* Triggers/Display */}
      <Box className="flex min-w-0 flex-col gap-1">
        {trendlinesSection}
      </Box>
    </>
  );

  if (panel()) {
    // Explicit, top-aligned columns so the grouping is obvious:
    //   What (presets/family/direction/status/quality) · Patterns · Refine.
    return (
      <CompactPanel flush testId="patterns-filter-rail">
        <Box
          className="grid grid-cols-1 items-start gap-2 lg:grid-cols-[minmax(220px,0.78fr)_minmax(320px,1.4fr)_minmax(320px,1.2fr)]"
        >
          <Box className="flex min-w-0 flex-col gap-1.5">
            {presetsSection}
            {familySection}
            {directionSection}
            {statusSection}
            {qualitySection}
            {sortSection}
            {historySection}
          </Box>
          <Box className="flex min-w-0 flex-col gap-1.5">
            {patternsSection}
          </Box>
          <Box className="flex min-w-0 flex-col gap-1.5">
            <Section title="Freshness">
              <Box
                className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-1"
              >
                {formedSection}
                {dateSection}
              </Box>
            </Section>
            <Section title="Structure">
              <Box
                className="grid grid-cols-2 gap-1"
              >
                {baseSection}
                {rangeSection}
                {gap52Section}
                {rangePosSection}
              </Box>
            </Section>
            <button
              type="button"
              onClick={() => setAdvancedOpen((open) => !open)}
              aria-expanded={advancedOpen()}
              aria-controls="patterns-advanced-section"
              data-testid="patterns-filter-advanced"
              className="inline-flex h-6 items-center self-start rounded-fin border border-fin-border bg-transparent px-2 text-xs text-fin-text-muted transition-colors hover:bg-fin-surface-alt"
            >
              {advancedOpen() ? "Advanced ▾" : advancedActive() ? "Advanced •" : "Advanced ▸"}
            </button>
            <Box
              id="patterns-advanced-section"
              className={advancedOpen() ? "flex flex-col gap-1.5" : "hidden"}
            >
            <Section title="Scores">
              <Box
                className="grid grid-cols-2 gap-1"
              >
                {scoreSection}
                {breakoutSection}
              </Box>
              {volumeSection}
            </Section>
            <Section title="Volume scan">
              <Box
                className="grid grid-cols-[repeat(auto-fit,minmax(80px,1fr))] gap-1"
              >
                {relVolumeField}
                {volumeMField}
                {avgVolume10dField}
              </Box>
            </Section>
            <Section title="Display">{trendlinesSection}</Section>
            </Box>
          </Box>
        </Box>
      </CompactPanel>
    );
  }

  return (
    <CompactPanel flush testId="patterns-filter-rail">
      {railContent}
    </CompactPanel>
  );
}
