import { Box, Button, Chip, Divider, NumberInput, Select, Switch, Text, ToolbarRow, Tooltip } from "@/ui";
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
  STATUS_INFO,
} from "@/config/patternCatalog";
import { PatternPresets } from "./PatternPresets";
import { PatternImage } from "./PatternImage";

const FAMILY_LABELS: Record<string, string> = {
  reversal: "Reversal",
  continuation: "Continuation",
  curve_cup: "Curve & Cup",
};

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
  children,
}: {
  title: string;
  info?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          borderBottom: "1px solid",
          borderColor: "divider",
          pb: 0.5,
        }}
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
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, maxWidth: 260 }}>
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
}: PatternFilterRailProps) {
  const panel = layout === "panel";
  const familyOrder = Array.from(new Set([...FAMILY_ORDER, ...patterns.map((p) => p.family)]));
  const families = familyOrder.map((id) => ({
    id,
    label: FAMILY_LABELS[id] ?? id,
    count: summary?.family_counts?.[id] ?? results.filter((r) => r.family === id).length,
  }));

  const selectedFamilies = asArray(filters.family);
  const selectedPatterns = asArray(filters.pattern_id);
  const selectedDirections = asArray(filters.direction);
  const selectedStatuses = asArray(filters.status);
  const formedWithin = filters.formed_within_bars ?? null;
  const minBaseDays = filters.min_base_days ?? null;
  const sort = filters.sort ?? "confidence";

  const pagePatternCounts = new Map<string, number>();
  for (const result of results) {
    pagePatternCounts.set(result.pattern_id, (pagePatternCounts.get(result.pattern_id) ?? 0) + 1);
  }
  const patternCountFor = (patternId: string): number =>
    summary?.pattern_counts?.[patternId] ?? pagePatternCounts.get(patternId) ?? 0;

  const presetsSection = (
    <Section title="Presets">
      <PatternPresets filters={filters} applyFilters={applyFilters} />
    </Section>
  );

  const familySection = (
    <Section title="Pattern family">
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
        {families.map((f) => (
          <Chip
            key={f.id}
            size="sm"
            variant="light"
            checked={selectedFamilies.includes(f.id)}
            onChange={() => setFilter("family", toggle(selectedFamilies, f.id))}
            data-testid={`patterns-family-${f.id}`}
          >
            {f.label} ({f.count})
          </Chip>
        ))}
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
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            togglePattern();
          }
        }}
        data-testid={`patterns-filter-pattern-${patternId}`}
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 0.5,
          p: 0.5,
          minWidth: 0,
          border: "1px solid",
          borderColor: selected ? "primary.main" : "divider",
          bgcolor: selected ? "action.selected" : "background.default",
          borderRadius: 1,
          cursor: "pointer",
          transition: "border-color 120ms ease",
          "&:hover": { borderColor: "primary.main" },
          "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 1 },
        }}
      >
        <PatternImage
          patternId={patternId}
          images={images ?? {}}
          height={54}
          showPlaceholderLabel={false}
        />
        <Text size="xs" fw={selected ? 700 : 500} lineClamp={2} sx={{ lineHeight: 1.25, minHeight: 30 }}>
          {label} ({count})
        </Text>
      </Box>
    );
  };

  const patternsSection = (
    <Section title="Patterns">
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        {PATTERN_FAMILIES.map((family) => (
          <Box
            key={family.id}
            sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}
            data-testid={`patterns-filter-family-group-${family.id}`}
          >
            <Text size="xs" c="dimmed" fw={600}>
              {family.label}
            </Text>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: 1,
              }}
            >
              {family.patterns.map((pattern) =>
                patternTile(
                  pattern.id,
                  PATTERN_LABELS[pattern.id] ?? pattern.name,
                  patternCountFor(pattern.id),
                ),
              )}
            </Box>
          </Box>
        ))}
      </Box>
    </Section>
  );

  const directionSection = (
    <Section title="Direction">
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
        {(["bullish", "bearish"] as const).map((dir) => (
          <Chip
            key={dir}
            size="sm"
            variant="light"
            color={dir === "bullish" ? "success" : "error"}
            checked={selectedDirections.includes(dir)}
            onChange={() => setFilter("direction", toggle(selectedDirections, dir))}
            data-testid={`patterns-direction-${dir}`}
          >
            {dir === "bullish" ? "Bullish" : "Bearish"}
          </Chip>
        ))}
      </Box>
    </Section>
  );

  const statusSection = (
    <Section
      title="Status"
      info={
        <InfoTip
          title="Detection status"
          items={infoItems(STATUS_INFO)}
          testId="patterns-status-info"
        />
      }
    >
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
        {(["forming", "confirmed", "failed", "marginal"] as const).map((status) => (
          <Chip
            key={status}
            size="sm"
            variant="light"
            checked={selectedStatuses.includes(status)}
            onChange={() => setFilter("status", toggle(selectedStatuses, status))}
            data-testid={`patterns-status-filter-${status}`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </Chip>
        ))}
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
          { value: "", label: "Any" },
          { value: "fair", label: "Fair+" },
          { value: "strong", label: "Strong+" },
          { value: "textbook", label: "Textbook" },
        ]}
        value={filters.quality ?? ""}
        onChange={(v) => setFilter("quality", v ? v : null)}
        size="sm"
        data-testid="patterns-quality-select"
      />
    </Section>
  );

  const formedSection = (
    <Section title="Formed within (bars)">
      <Box
        data-testid="patterns-filter-formed-within"
        sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}
      >
        <Text size="xs" c="dimmed">
          1D: 1 bar = 1 day
        </Text>
        <NumberInput
          value={formedWithin ?? ""}
          onChange={(v: number | string) => {
            if (v === "" || v == null) {
              setFilter("formed_within_bars", null);
              return;
            }
            const n = Number(v);
            // Ignore in-progress partials ("-", "1.") — never store NaN.
            if (!Number.isNaN(n)) setFilter("formed_within_bars", n);
          }}
          min={1}
          step={1}
          size="sm"
          placeholder="Any"
          w={110}
          data-testid="patterns-formed-within"
        />
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {FORMED_PRESETS.map((preset) => (
            <Chip
              key={preset}
              size="xs"
              variant="light"
              checked={formedWithin === preset}
              onChange={() => setFilter("formed_within_bars", formedWithin === preset ? null : preset)}
              data-testid={`patterns-formed-within-${preset}`}
            >
              {preset}
            </Chip>
          ))}
        </Box>
      </Box>
    </Section>
  );

  const sortSection = (
    <Section title="Sort">
      <Box
        data-testid="patterns-filter-sort"
        sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}
      >
        <Chip
          size="sm"
          variant="light"
          checked={sort !== "newest"}
          onChange={() => setFilter("sort", "confidence")}
          data-testid="patterns-filter-sort-confidence"
        >
          Confidence
        </Chip>
        <Chip
          size="sm"
          variant="light"
          checked={sort === "newest"}
          onChange={() => setFilter("sort", "newest")}
          data-testid="patterns-filter-sort-newest"
        >
          Newest
        </Chip>
      </Box>
    </Section>
  );

  const baseSection = (
    <Section title="Base length (days)">
      <ToolbarRow gap={4} data-testid="patterns-filter-min-base">
        <Chip
          size="xs"
          variant="light"
          checked={minBaseDays == null}
          onChange={() => setFilter("min_base_days", null)}
          data-testid="patterns-filter-min-base-any"
        >
          Any
        </Chip>
        {BASE_LENGTH_PRESETS.map((preset) => (
          <Chip
            key={preset}
            size="xs"
            variant="light"
            checked={minBaseDays === preset}
            onChange={() => setFilter("min_base_days", minBaseDays === preset ? null : preset)}
            data-testid={`patterns-filter-min-base-${preset}`}
          >
            {preset}
          </Chip>
        ))}
      </ToolbarRow>
    </Section>
  );

  const rangeSection = (
    <Section title="Range ≤ %">
      <NumberInput
        value={filters.max_range_pct ?? ""}
        onChange={(v: number | string) => {
          if (v === "" || v == null) {
            setFilter("max_range_pct", null);
            return;
          }
          const n = Number(v);
          // Ignore in-progress partials ("-", "1.") — never store NaN.
          if (!Number.isNaN(n)) setFilter("max_range_pct", n);
        }}
        min={0}
        step={1}
        size="sm"
        placeholder="Any"
        w={110}
        data-testid="patterns-filter-max-range"
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
          { value: "support", label: "Support only" },
          { value: "resistance", label: "Resistance only" },
          { value: "none", label: "None" },
        ]}
        value={filters.trendlines ?? "both"}
        onChange={(v) => setFilter("trendlines", (v ?? "both") as TrendlinesView)}
        size="sm"
        data-testid="patterns-filter-trendlines"
      />
    </Section>
  );

  const volumeSection = (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
      <Switch
        label="Volume confirmed"
        size="sm"
        checked={Boolean(filters.volume_confirmed)}
        onChange={(e) => setFilter("volume_confirmed", e.target.checked ? true : null)}
        data-testid="patterns-volume-confirmed"
      />
      {!panel && (
        <Button
          size="xs"
          variant="outline"
          onClick={resetFilters}
          data-testid="patterns-reset"
        >
          Reset
        </Button>
      )}
    </Box>
  );

  if (panel) {
    // Explicit, top-aligned columns so the grouping is obvious:
    //   What (presets/family/direction/status/quality) · Patterns · Refine.
    return (
      <Box
        data-testid="patterns-filter-rail"
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "minmax(0, 1fr)",
            md: "minmax(0, 1fr) minmax(0, 1.5fr) minmax(0, 1fr)",
          },
          gap: 3,
          alignItems: "start",
        }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5, minWidth: 0 }}>
          {presetsSection}
          {familySection}
          {directionSection}
          {statusSection}
          {qualitySection}
        </Box>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5, minWidth: 0 }}>
          {patternsSection}
        </Box>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5, minWidth: 0 }}>
          {formedSection}
          {sortSection}
          {trendlinesSection}
          {baseSection}
          {rangeSection}
          {volumeSection}
        </Box>
      </Box>
    );
  }

  return (
    <Box
      data-testid="patterns-filter-rail"
      sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}
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
      {sortSection}
      <Divider />
      {trendlinesSection}
      <Divider />
      {baseSection}
      <Divider />
      {rangeSection}
      <Divider />
      {volumeSection}
    </Box>
  );
}
