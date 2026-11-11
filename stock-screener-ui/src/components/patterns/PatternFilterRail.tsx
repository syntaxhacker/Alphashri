import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { ActionIcon, Box, Button, Chip, Divider, MultiSelect, Select, Switch, Text, TextInput, ToolbarRow, Tooltip } from "@/ui";
import { IconX, IconRestore } from "@tabler/icons-react";
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
  /** Aggregate counts for the whole filtered set (chips prefer these over `results`). */
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

function Section({
  title,
  info,
  level = "group",
  children,
}: {
  title: string;
  info?: React.ReactNode;
  level?: "group" | "field";
  children: React.ReactNode;
}) {
  // `field` is the compact form used inside a group: a 10px muted label and the
  // control, with no rule. `group` owns the single rule for a group of fields.
  if (level === "field") {
    return (
      <Box className="flex min-w-0 flex-col gap-0.5">
        <Box className="flex items-center gap-1">
          <Text size="xs" c="dimmed" style={{ fontSize: 10, lineHeight: 1.2 }}>
            {title}
          </Text>
          {info}
        </Box>
        {children}
      </Box>
    );
  }
  return (
    <Box className="flex flex-col gap-1">
      <Box
        className="flex items-center gap-1 border-b border-fin-border pb-0.5"
      >
        <Text size="xs" fw={700} style={{ textTransform: "uppercase", letterSpacing: 0.4 }} c="dimmed">
          {title}
        </Text>
        {info}
      </Box>
      {children}
    </Box>
  );
}

/** Compact `?` help affordance listing a set of `{label, description}` entries. */
function InfoTip({
  title,
  items,
  testId,
}: {
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
            {title}
          </Text>
          {items.map((item) => (
            <Text key={item.label} size="xs">
              <strong>{item.label}</strong>: {item.description}
            </Text>
          ))}
        </Box>
      }
    >
      <Text
        size="xs"
        c="dimmed"
        style={{ cursor: "help", userSelect: "none", lineHeight: 1 }}
        data-testid={testId}
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
export function PatternFilterRail({
  patterns,
  results,
  summary,
  filters,
  setFilter,
  resetFilters,
  applyFilters,
  images,
  layout = "rail",
  onReplayScan,
}: PatternFilterRailProps) {
  const panel = layout === "panel";
  // Compact pattern picker state (panel layout). Search + hide-zero keep the
  // gallery scannable without forcing a long scroll past empty patterns.
  const [patternQuery, setPatternQuery] = useState("");
  // A user who arrives with advanced filters already applied must see them,
  // not a collapsed section that silently hides the active constraints.
  const advancedActive =
    filters.min_confidence != null ||
    filters.min_breakout_score != null ||
    filters.min_rel_volume != null ||
    filters.min_volume_m != null ||
    (filters.min_avg_volume_10d != null &&
      filters.min_avg_volume_10d !== DEFAULT_PATTERN_FILTERS.min_avg_volume_10d) ||
    (filters.trendlines ?? "both") !== "both";
  const [advancedOpen, setAdvancedOpen] = useState(advancedActive);
  const [hideZero, setHideZero] = useState(false);
  // One pass over the results feeds both family and pattern counters; the old
  // code re-scanned `results` once per family on every render.
  const { familyCounts, patternCounts } = useMemo(() => {
    const familyMap = new Map<string, number>();
    const patternMap = new Map<string, number>();
    for (const result of results) {
      familyMap.set(result.family, (familyMap.get(result.family) ?? 0) + 1);
      patternMap.set(result.pattern_id, (patternMap.get(result.pattern_id) ?? 0) + 1);
    }
    return { familyCounts: familyMap, patternCounts: patternMap };
  }, [results]);

  const families = useMemo(() => {
    const order = Array.from(new Set([...FAMILY_ORDER, ...patterns.map((p) => p.family)]));
    return order.map((id) => ({
      id,
      label: FAMILY_LABELS[id] ?? id,
      count: summary?.family_counts?.[id] ?? familyCounts.get(id) ?? 0,
    }));
  }, [patterns, summary, familyCounts]);

  const selectedFamilies = asArray(filters.family);
  const selectedPatterns = asArray(filters.pattern_id);
  const selectedDirections = asArray(filters.direction);
  const selectedStatuses = asArray(filters.status);
  const formedWithin = filters.formed_within_bars ?? null;
  const minBaseDays = filters.min_base_days ?? null;
  const sort = filters.sort ?? "confidence";

  const patternCountFor = useCallback(
    (patternId: string): number =>
      summary?.pattern_counts?.[patternId] ?? patternCounts.get(patternId) ?? 0,
    [summary, patternCounts],
  );

  // The gallery only depends on the query, the zero filter and the counters —
  // not on unrelated filter changes or typing in other inputs.
  const deferredQuery = useDeferredValue(patternQuery);
  const query = deferredQuery.trim().toLowerCase();
  const gallery = useMemo(
    () =>
      PATTERN_FAMILIES.map((family) => ({
        family,
        visible: family.patterns.filter((pattern) => {
          if (hideZero && patternCountFor(pattern.id) === 0) return false;
          if (!query) return true;
          const label = PATTERN_LABELS[pattern.id] ?? pattern.name;
          return label.toLowerCase().includes(query);
        }),
      })).filter((group) => group.visible.length > 0),
    [hideZero, patternCountFor, query],
  );

  const presetsSection = (
    <Section title="Presets">
      <PatternPresets filters={filters} applyFilters={applyFilters} />
    </Section>
  );

  const familySection = (
    <Section title="Pattern family">
      <Box
        data-testid="patterns-family-select"
        title={
          selectedFamilies.length
            ? selectedFamilies
                .map((id) => families.find((f) => f.id === id)?.label ?? id)
                .join(", ")
            : undefined
        }
      >
        <MultiSelect
          data={families.map((f) => ({ value: f.id, label: `${f.label} (${f.count})` }))}
          value={selectedFamilies}
          onChange={(vals) => setFilter("family", vals)}
          size="xs"
          placeholder={
            selectedFamilies.length ? `${selectedFamilies.length} selected` : "Any family"
          }
          clearable
          hideTags
        />
      </Box>
    </Section>
  );

  const patternTile = (patternId: string, label: string, count: number) => {
    const selected = selectedPatterns.includes(patternId);
    const togglePattern = () => setFilter("pattern_id", toggle(selectedPatterns, patternId));
    return (
      <Box
        key={patternId}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={togglePattern}
        onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            togglePattern();
          }
        }}
        data-testid={`patterns-filter-pattern-${patternId}`}
        className={cn(
          "flex min-w-0 cursor-pointer items-center gap-[3px] rounded-fin border px-1 py-[2px] transition-[border-color,background-color] duration-[120ms]",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fin-primary",
          selected
            ? "border-fin-primary bg-fin-primary/12"
            : "border-fin-border bg-transparent hover:border-fin-primary hover:bg-fin-surface-alt",
        )}
      >
        <Box
          aria-hidden="true"
          className="h-[14px] w-6 shrink-0 overflow-hidden rounded-sm"
        >
          <PatternImage
            patternId={patternId}
            images={images ?? {}}
            height={14}
            showPlaceholderLabel={false}
          />
        </Box>
        <Box className="flex min-w-0 flex-1 items-baseline">
          <Text
            size="xs"
            fw={selected ? 700 : 500}
            truncate
            className="min-w-0 leading-[1.2]"
          >
            {label}
          </Text>
          <Text
            size="xs"
            c={count > 0 ? "text.secondary" : "dimmed"}
            style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", paddingLeft: 3 }}
          >
            {` (${count})`}
          </Text>
        </Box>
      </Box>
    );
  };

  const patternsSection = (
    <Section title="Patterns">
      <Box className="flex flex-col gap-2">
        <ToolbarRow gap={6}>
          <Box className="min-w-0 flex-1">
            <TextInput
              value={patternQuery}
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
            checked={hideZero}
            onChange={(e) => setHideZero(e.target.checked)}
            data-testid="patterns-filter-hide-zero"
          />
        </ToolbarRow>
        {selectedPatterns.length >= 2 ? (
          <Switch
            label="Match in order (sequence)"
            size="xs"
            checked={Boolean(filters.sequence)}
            onChange={(e) => setFilter("sequence", e.target.checked)}
            data-testid="patterns-filter-sequence"
          />
        ) : null}
        {filters.sequence && selectedPatterns.length >= 2 ? (
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
                value={filters.sequence_gap_days == null ? "any" : String(filters.sequence_gap_days)}
                onChange={(v) => setFilter("sequence_gap_days", v === "any" ? null : Number(v))}
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
                value={filters.sequence_max_bars == null ? "any" : String(filters.sequence_max_bars)}
                onChange={(v) => setFilter("sequence_max_bars", v === "any" ? null : Number(v))}
                size="xs"
                data-testid="patterns-filter-sequence-bars"
              />
            </ToolbarRow>
            <ToolbarRow gap={4}>
              <Text size="xs" c="dimmed">Earlier steps</Text>
              {["confirmed", "forming"].map((status) => {
                const active = (filters.sequence_step_status ?? []).includes(status);
                return (
                  <Chip
                    key={status}
                    size="xs"
                    variant="light"
                    checked={active}
                    onChange={() => {
                      const current = filters.sequence_step_status ?? [];
                      setFilter(
                        "sequence_step_status",
                        active ? current.filter((x) => x !== status) : [...current, status],
                      );
                    }}
                    data-testid={`patterns-filter-sequence-status-${status}`}
                  >
                    {status === "confirmed" ? "Confirmed" : "Forming"}
                  </Chip>
                );
              })}
            </ToolbarRow>
          </Box>
        ) : null}
        {selectedPatterns.length > 0 ? (
          <ToolbarRow gap={4}>
            <Text size="xs" c="dimmed">
              {`${selectedPatterns.length} selected`}
            </Text>
            <Tooltip label="Clear selected patterns">
              <ActionIcon
                size="xs"
                variant="subtle"
                aria-label="Clear patterns"
                onClick={() => setFilter("pattern_id", [])}
                data-testid="patterns-filter-pattern-clear"
              >
                <IconX size={14} />
              </ActionIcon>
            </Tooltip>
          </ToolbarRow>
        ) : null}
        <Box
          className="flex max-h-[340px] flex-col gap-1 overflow-y-auto pr-1"
        >
        {gallery.map(({ family, visible }) => {
          return (
            <Box
              key={family.id}
              className="flex flex-col gap-0.5"
              data-testid={`patterns-filter-family-group-${family.id}`}
            >
              <Text size="xs" c="dimmed" fw={600} style={{ fontSize: 10 }}>
                {family.label}
              </Text>
              <Box
                className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-0.5"
              >
                {visible.map((pattern) =>
                  patternTile(
                    pattern.id,
                    PATTERN_LABELS[pattern.id] ?? pattern.name,
                    patternCountFor(pattern.id),
                  ),
                )}
              </Box>
            </Box>
          );
        })}
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
          value={selectedDirections}
          onChange={(vals) => setFilter("direction", vals)}
          size="xs"
          placeholder={
            selectedDirections.length ? `${selectedDirections.length} selected` : "Any direction"
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
          value={selectedStatuses}
          onChange={(vals) => setFilter("status", vals)}
          size="xs"
          placeholder={
            selectedStatuses.length ? `${selectedStatuses.length} selected` : "Any status"
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
        value={filters.quality ?? "any"}
        onChange={(v) => setFilter("quality", v && v !== "any" ? v : null)}
        size="xs"
        data-testid="patterns-quality-select"
      />
    </Section>
  );

  const formedSection = (
    <Section title="Formed within (bars)" level="field">
      <Box data-testid="patterns-filter-formed-within">
        <Select
          data={[
            { value: "any", label: "Any" },
            ...FORMED_PRESETS.map((n) => ({ value: String(n), label: String(n) })),
          ]}
          value={formedWithin == null ? "any" : String(formedWithin)}
          onChange={(v) => setFilter("formed_within_bars", v === "any" ? null : Number(v))}
          size="xs"
          data-testid="patterns-filter-formed-within-select"
        />
      </Box>
    </Section>
  );

  const dateSection = (
    <Section title="Formed between" level="field">
      <Box className="flex flex-col gap-2">
        <Box className="flex flex-col gap-1">
          <Text size="xs" c="dimmed">
            From
          </Text>
          <ToolbarRow gap={4}>
            <TextInput
              type="datetime-local"
              value={filters.from_date ?? ""}
              onChange={(v) => setFilter("from_date", v ? String(v) : null)}
              size="xs"
              w={190}
              data-testid="patterns-filter-from-date"
            />
            {filters.from_date ? (
              <Button
                size="xs"
                variant="subtle"
                onClick={() => setFilter("from_date", null)}
                data-testid="patterns-filter-from-date-clear"
              >
                Clear
              </Button>
            ) : null}
          </ToolbarRow>
        </Box>
        <Box className="flex flex-col gap-1">
          <Text size="xs" c="dimmed">
            To
          </Text>
          <ToolbarRow gap={4}>
            <TextInput
              type="datetime-local"
              value={filters.to_date ?? ""}
              onChange={(v) => setFilter("to_date", v ? String(v) : null)}
              size="xs"
              w={190}
              data-testid="patterns-filter-to-date"
            />
            {filters.to_date ? (
              <Button
                size="xs"
                variant="subtle"
                onClick={() => setFilter("to_date", null)}
                data-testid="patterns-filter-to-date-clear"
              >
                Clear
              </Button>
            ) : null}
          </ToolbarRow>
        </Box>
        <Box className="flex flex-wrap gap-1">
          <Chip
            size="xs"
            variant="light"
            onChange={() => setFilter("from_date", daysAgoDatetimeLocal(30))}
            data-testid="patterns-filter-date-last-30d"
          >
            Last 30 days
          </Chip>
          <Chip
            size="xs"
            variant="light"
            onChange={() => setFilter("from_date", startOfMonthDatetimeLocal())}
            data-testid="patterns-filter-date-this-month"
          >
            This month
          </Chip>
        </Box>
      </Box>
    </Section>
  );

  const replaySection = onReplayScan ? (
    <Section title="Replay scan">
      <ReplayScanControl onReplayScan={onReplayScan} />
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
          value={sort}
          onChange={(v) => setFilter("sort", v)}
          size="xs"
          data-testid="patterns-filter-sort-select"
        />
      </Box>
    </Section>
  );

  const historySection = (
    <Section
      title="Patterns per symbol"
      level="field"
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
        {[1, 3, 5].map((n) => (
          <Chip
            key={n}
            size="xs"
            variant="light"
            checked={(filters.history ?? 1) === n}
            onChange={() => setFilter("history", n)}
            data-testid={`patterns-filter-history-${n}`}
          >
            {n}
          </Chip>
        ))}
      </ToolbarRow>
    </Section>
  );

  const baseSection = (
    <Section title="Base length (days)" level="field">
      <Box data-testid="patterns-filter-min-base">
        <Select
          data={[
            { value: "any", label: "Any" },
            ...BASE_LENGTH_PRESETS.map((n) => ({ value: String(n), label: String(n) })),
          ]}
          value={minBaseDays == null ? "any" : String(minBaseDays)}
          onChange={(v) => setFilter("min_base_days", v === "any" ? null : Number(v))}
          size="xs"
          data-testid="patterns-filter-min-base-select"
        />
      </Box>
    </Section>
  );

  const rangeSection = (
    <Section title="Range ≤ %" level="field">
      <FilterNumber
        value={filters.max_range_pct}
        onChange={(v) => setFilter("max_range_pct", v)}
        min={0}
        step={1}
        testId="patterns-filter-max-range"
      />
    </Section>
  );

  const gap52Section = (
    <Section title="52W gap ≤ %" level="field">
      <FilterNumber
        value={filters.max_52w_gap}
        onChange={(v) => setFilter("max_52w_gap", v)}
        min={0}
        max={25}
        step={0.5}
        testId="patterns-filter-max-52w-gap"
      />
    </Section>
  );

  const rangePosSection = (
    <Section title="Range pos ≥ %" level="field">
      <FilterNumber
        value={filters.min_range_pos}
        onChange={(v) => setFilter("min_range_pos", v)}
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
    <Section title="Score ≥" level="field">
      <FilterNumber
        value={filters.min_confidence}
        onChange={(v) => setFilter("min_confidence", v)}
        min={0}
        max={100}
        step={5}
        testId="patterns-filter-min-confidence"
      />
    </Section>
  );

  const breakoutSection = (
    <Section title="Breakout ≥" level="field">
      <FilterNumber
        value={filters.min_breakout_score}
        onChange={(v) => setFilter("min_breakout_score", v)}
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
    <Section title="Rel vol ≥" level="field">
      <FilterNumber
        value={filters.min_rel_volume}
        onChange={(v) => setFilter("min_rel_volume", v)}
        min={0}
        max={10}
        step={0.5}
        testId="patterns-filter-min-rel-volume"
      />
    </Section>
  );

  const volumeMField = (
    <Section title="Volume ≥ M" level="field">
      <FilterNumber
        value={filters.min_volume_m}
        onChange={(v) => setFilter("min_volume_m", v)}
        min={0}
        max={500}
        step={5}
        testId="patterns-filter-min-volume-m"
      />
    </Section>
  );

  const avgVolume10dField = (
    <Section title="10d avg vol ≥ K" level="field">
      <FilterNumber
        value={filters.min_avg_volume_10d}
        onChange={(v) => setFilter("min_avg_volume_10d", v)}
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
    <Section title="Trendlines" level="field">
      <Select
        data={[
          { value: "both", label: "Both" },
          { value: "support", label: "TLS only" },
          { value: "resistance", label: "TLR only" },
          { value: "none", label: "None" },
        ]}
        value={filters.trendlines ?? "both"}
        onChange={(v) => setFilter("trendlines", (v ?? "both") as TrendlinesView)}
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
        checked={Boolean(filters.volume_confirmed)}
        onChange={(e) => setFilter("volume_confirmed", e.target.checked ? true : null)}
        data-testid="patterns-volume-confirmed"
      />
      {!panel && (
        <Tooltip label="Reset all filters">
          <ActionIcon
            size="xs"
            variant="outline"
            aria-label="Reset filters"
            onClick={resetFilters}
            data-testid="patterns-reset"
          >
            <IconRestore size={14} />
          </ActionIcon>
        </Tooltip>
      )}
    </Box>
  );

  if (panel) {
    // Explicit, top-aligned columns so the grouping is obvious:
    //   What (presets/family/direction/status/quality) · Patterns · Refine.
    return (
      <Box
        data-testid="patterns-filter-rail"
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
          <Button
            size="xs"
            variant="subtle"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
            aria-controls="patterns-advanced-section"
            data-testid="patterns-filter-advanced"
          >
            {advancedOpen ? "Advanced ▾" : advancedActive ? "Advanced •" : "Advanced ▸"}
          </Button>
          <Box
            id="patterns-advanced-section"
            className={advancedOpen ? "flex flex-col gap-1.5" : "hidden"}
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
    );
  }

  return (
    <Box
      data-testid="patterns-filter-rail"
      className="flex flex-col gap-3"
    >
      {presetsSection}
      <Divider />
      {familySection}
      <Divider />
      {patternsSection}
      <Divider />
      {directionSection}
      <Divider />
      {statusSection}
      <Divider />
      {qualitySection}
      <Divider />
      {formedSection}
      <Divider />
      {dateSection}
      <Divider />
      {sortSection}
{historySection}
      <Divider />
      {trendlinesSection}
      <Divider />
      {baseSection}
      <Divider />
      {rangeSection}
      <Divider />
      {gap52Section}
      <Divider />
      {rangePosSection}
      <Divider />
      {scoreSection}
      <Divider />
      {breakoutSection}
      <Divider />
      <Section title="Volume scan">
        <Box
          className="grid grid-cols-3 gap-2"
        >
          {relVolumeField}
          {volumeMField}
          {avgVolume10dField}
        </Box>
      </Section>
      <Divider />
      {replaySection}
      {replaySection ? <Divider /> : null}
      {volumeSection}
    </Box>
  );
}
