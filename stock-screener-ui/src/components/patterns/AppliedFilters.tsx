import { Box, Button, Chip, Text, ToolbarRow } from "@/ui";
import type { PatternDef, PatternFilters } from "@/types/chartPatterns";

/** One removable chip in the applied-filters row. */
export interface AppliedFilterChip {
  /** Stable identity for React keys / testids. */
  id: string;
  /** Group label, e.g. "Direction". */
  group: string;
  /** Value label, e.g. "Bullish". */
  label: string;
  /** Filter key this chip edits. */
  key: keyof PatternFilters;
  /** Value to write when the chip's close button is pressed. */
  nextValue: PatternFilters[keyof PatternFilters];
}

const FAMILY_LABELS: Record<string, string> = {
  reversal: "Reversal",
  continuation: "Continuation",
  curve_cup: "Curve & Cup",
};

/** `"formed_within_bars"` → `"Formed Within Bars"`. */
function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Flatten the active filter set into one chip per applied value, each carrying
 * the value to write when its close button removes it. `symbols` / `q` are
 * intentionally omitted — they are already shown (and removable) inline by
 * `SymbolFilter` / `ResultsSearch` in the toolbar, so repeating them here would
 * duplicate the same control.
 */
export function buildAppliedFilterChips(
  filters: PatternFilters,
  patterns: PatternDef[] = [],
): AppliedFilterChip[] {
  const chips: AppliedFilterChip[] = [];
  const nameOf = (id: string) =>
    patterns.find((p) => p.pattern_id === id)?.name ?? titleCase(id);

  (filters.family ?? []).forEach((v) =>
    chips.push({
      id: `family:${v}`,
      group: "Family",
      label: FAMILY_LABELS[v] ?? titleCase(v),
      key: "family",
      nextValue: (filters.family ?? []).filter((x) => x !== v),
    }),
  );
  (filters.pattern_id ?? []).forEach((v) =>
    chips.push({
      id: `pattern_id:${v}`,
      group: "Pattern",
      label: nameOf(v),
      key: "pattern_id",
      nextValue: (filters.pattern_id ?? []).filter((x) => x !== v),
    }),
  );
  (filters.direction ?? []).forEach((v) =>
    chips.push({
      id: `direction:${v}`,
      group: "Direction",
      label: titleCase(v),
      key: "direction",
      nextValue: (filters.direction ?? []).filter((x) => x !== v),
    }),
  );
  (filters.status ?? []).forEach((v) =>
    chips.push({
      id: `status:${v}`,
      group: "Status",
      label: titleCase(v),
      key: "status",
      nextValue: (filters.status ?? []).filter((x) => x !== v),
    }),
  );
  if (filters.quality) {
    chips.push({
      id: `quality:${filters.quality}`,
      group: "Quality",
      label: titleCase(filters.quality),
      key: "quality",
      nextValue: null,
    });
  }
  if (filters.formed_within_bars != null) {
    chips.push({
      id: "formed_within_bars",
      group: "Formed",
      label: `within ${filters.formed_within_bars} bars`,
      key: "formed_within_bars",
      nextValue: null,
    });
  }
  if (filters.volume_confirmed != null) {
    chips.push({
      id: "volume_confirmed",
      group: "Volume",
      label: filters.volume_confirmed ? "Confirmed" : "Unconfirmed",
      key: "volume_confirmed",
      nextValue: null,
    });
  }
  if (filters.min_rr != null) {
    chips.push({
      id: "min_rr",
      group: "R:R",
      label: `≥ ${filters.min_rr}`,
      key: "min_rr",
      nextValue: null,
    });
  }
  if (filters.symbol) {
    chips.push({
      id: `symbol:${filters.symbol}`,
      group: "Symbol",
      label: filters.symbol,
      key: "symbol",
      nextValue: null,
    });
  }
  if (filters.min_base_days != null) {
    chips.push({
      id: "min_base_days",
      group: "Base",
      label: `≥ ${filters.min_base_days}d`,
      key: "min_base_days",
      nextValue: null,
    });
  }
  if (filters.max_range_pct != null) {
    chips.push({
      id: "max_range_pct",
      group: "Range",
      label: `≤ ${filters.max_range_pct}%`,
      key: "max_range_pct",
      nextValue: null,
    });
  }
  if (filters.max_52w_gap != null) {
    chips.push({
      id: "max_52w_gap",
      group: "52W",
      label: `gap ≤ ${filters.max_52w_gap}%`,
      key: "max_52w_gap",
      nextValue: null,
    });
  }
  if (filters.min_range_pos != null) {
    chips.push({
      id: "min_range_pos",
      group: "Range",
      label: `pos ≥ ${filters.min_range_pos}%`,
      key: "min_range_pos",
      nextValue: null,
    });
  }
  if (filters.sort && filters.sort !== "confidence") {
    chips.push({
      id: `sort:${filters.sort}`,
      group: "Sort",
      label:
        filters.sort === "newest"
          ? "Latest formed"
          : filters.sort === "range_pos"
            ? "Near breakout"
            : titleCase(filters.sort),
      key: "sort",
      nextValue: "confidence",
    });
  }
  // View-only overlay toggle (client-side only): one chip that resets to Both.
  if (filters.trendlines && filters.trendlines !== "both") {
    chips.push({
      id: "trendlines",
      group: "Trendlines",
      label:
        filters.trendlines === "support"
          ? "TLS only"
          : filters.trendlines === "resistance"
            ? "TLR only"
            : "Hidden",
      key: "trendlines",
      nextValue: "both",
    });
  }
  return chips;
}

export interface AppliedFiltersProps {
  filters: PatternFilters;
  /** Catalog, used to render pattern ids as readable names. */
  patterns?: PatternDef[];
  setFilter: (key: string, value: unknown) => void;
  resetFilters: () => void;
}

/**
 * Inline summary of the active filters, each removable with its close button —
 * so the modal never has to be reopened just to drop one filter. Renders
 * nothing when no filters are applied.
 */
export function AppliedFilters({ filters, patterns, setFilter, resetFilters }: AppliedFiltersProps) {
  const chips = buildAppliedFilterChips(filters, patterns);
  if (chips.length === 0) return null;

  return (
    <Box data-testid="patterns-applied-filters" sx={{ minWidth: 0 }}>
      <ToolbarRow gap={6} align="center" style={{ flexWrap: "wrap", rowGap: 6 }}>
        <Text size="xs" c="dimmed" fw={700} style={{ textTransform: "uppercase" }}>
          Applied
        </Text>
        {chips.map((chip) => (
          <Chip
            key={chip.id}
            size="xs"
            variant="light"
            checked
            data-testid={`patterns-applied-filter-${chip.id}`}
            onDelete={() => setFilter(chip.key, chip.nextValue)}
          >
            {`${chip.group}: ${chip.label}`}
          </Chip>
        ))}
        <Button
          size="xs"
          variant="subtle"
          onClick={resetFilters}
          data-testid="patterns-applied-clear-all"
        >
          Clear all
        </Button>
      </ToolbarRow>
    </Box>
  );
}
