import { createMemo, createSignal, For, Show } from "solid-js";
import { Box, Button, Text, ToolbarRow } from "@/ui";
import { PATTERN_CHIP_BG } from "@/ui/palette";
import { IconX } from "@/patterns/icons";
import { DEFAULT_PATTERN_FILTERS } from "@/state/chartPatterns";
import type { PatternDef, PatternFilters } from "@/types/chartPatterns";
import { FAMILY_LABELS } from "./shared";

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
  if (filters.min_confidence != null) {
    chips.push({
      id: "min_confidence",
      group: "Score",
      label: `≥ ${filters.min_confidence}`,
      key: "min_confidence",
      nextValue: null,
    });
  }
  if (filters.min_breakout_score != null) {
    chips.push({
      id: "min_breakout_score",
      group: "Breakout",
      label: `≥ ${filters.min_breakout_score}`,
      key: "min_breakout_score",
      nextValue: null,
    });
  }
  if (filters.min_rel_volume != null) {
    chips.push({
      id: "min_rel_volume",
      group: "Volume",
      label: `rel vol ≥ ${filters.min_rel_volume}`,
      key: "min_rel_volume",
      nextValue: null,
    });
  }
  if (filters.min_volume_m != null) {
    chips.push({
      id: "min_volume_m",
      group: "Volume",
      label: `vol ≥ ${filters.min_volume_m}M`,
      key: "min_volume_m",
      nextValue: null,
    });
  }
  // The 10d-avg-volume floor is a system default, not a user choice: showing it
  // as a removable chip made the chip count disagree with the Filters badge.
  if (
    filters.min_avg_volume_10d != null &&
    filters.min_avg_volume_10d !== DEFAULT_PATTERN_FILTERS.min_avg_volume_10d
  ) {
    chips.push({
      id: "min_avg_volume_10d",
      group: "Volume",
      label: `10d vol ≥ ${filters.min_avg_volume_10d}K`,
      key: "min_avg_volume_10d",
      nextValue: null,
    });
  }
  if (filters.from_date) {
    chips.push({
      id: "from_date",
      group: "Date",
      label: `formed ≥ ${String(filters.from_date).replace("T", " ")}`,
      key: "from_date",
      nextValue: null,
    });
  }
  if (filters.to_date) {
    chips.push({
      id: "to_date",
      group: "Date",
      label: `formed ≤ ${String(filters.to_date).replace("T", " ")}`,
      key: "to_date",
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

/** How many chips render inline before collapsing to a `+N` overflow chip. */
const MAX_VISIBLE_CHIPS = 6;

export interface AppliedFiltersProps {
  filters: PatternFilters;
  /** Catalog, used to render pattern ids as readable names. */
  patterns?: PatternDef[];
  setFilter: (key: string, value: unknown) => void;
  resetFilters: () => void;
}

/**
 * Inline summary of the active filters, grouped by filter family and each value
 * removable with its close button — so the modal never has to be reopened just
 * to drop one filter. Renders nothing when no filters are applied.
 */
export function AppliedFilters(props: AppliedFiltersProps) {
  const allChips = createMemo(() => buildAppliedFilterChips(props.filters, props.patterns));
  const [expanded, setExpanded] = createSignal(false);
  const visibleChips = createMemo(() =>
    expanded() ? allChips() : allChips().slice(0, MAX_VISIBLE_CHIPS),
  );
  const overflowCount = createMemo(() => allChips().length - visibleChips().length);

  // Consecutive chips sharing a `group` render under one muted label, so
  // "Pattern: A · Pattern: B · Pattern: C" becomes "Patterns  A  B  C".
  const groups = createMemo(() => {
    const next: Array<{ group: string; items: AppliedFilterChip[] }> = [];
    for (const chip of visibleChips()) {
      const last = next[next.length - 1];
      if (last && last.group === chip.group) last.items.push(chip);
      else next.push({ group: chip.group, items: [chip] });
    }
    return next;
  });

  return (
    <Show when={allChips().length > 0}>
      <Box data-testid="patterns-applied-filters" className="min-w-0">
        <ToolbarRow
          gap={4}
          wrap={false}
          className="min-w-0"
          style={{ "overflow-x": expanded() ? "auto" : "hidden" }}
        >
          <Text c="dimmed" fw={700} className="text-[9px] tracking-wide uppercase">
            Active
          </Text>
          <For each={groups()}>
            {(group) => {
              const multi = group.items.length > 1;
              return (
                <Box
                  data-testid={`patterns-applied-group-${group.group.toLowerCase()}`}
                  className="inline-flex min-w-0 items-center gap-[4px] pl-[2px]"
                >
                  <Show when={multi}>
                    <Text c="dimmed" fw={600} className="text-[9px] tracking-wide uppercase">
                      {`${group.group}s`}
                    </Text>
                  </Show>
                  <For each={group.items}>
                    {(chip) => (
                      <span
                        data-testid={`patterns-applied-filter-${chip.id}`}
                        className="inline-flex items-center gap-[4px] whitespace-nowrap rounded-fin border border-transparent px-2 py-1 text-xs text-fin-text"
                        style={{ "background-color": PATTERN_CHIP_BG }}
                      >
                        {multi ? chip.label : `${chip.group}: ${chip.label}`}
                        <button
                          type="button"
                          aria-label={`Remove ${multi ? chip.label : `${chip.group}: ${chip.label}`}`}
                          data-testid={`patterns-applied-filter-${chip.id}-remove`}
                          className="inline-flex cursor-pointer items-center justify-center rounded-sm p-0.5 leading-none hover:bg-white/10"
                          onClick={() => props.setFilter(chip.key, chip.nextValue)}
                        >
                          <IconX size={12} stroke={2.5} />
                        </button>
                      </span>
                    )}
                  </For>
                </Box>
              );
            }}
          </For>
          <Show when={overflowCount() > 0 && !expanded()}>
            <Button
              size="xs"
              variant="subtle"
              onClick={() => setExpanded(true)}
              data-testid="patterns-applied-overflow"
            >
              +{overflowCount()}
            </Button>
          </Show>
          <Show when={expanded()}>
            <Button
              size="xs"
              variant="subtle"
              onClick={() => setExpanded(false)}
              className="text-[9px] tracking-wide uppercase"
            >
              Collapse
            </Button>
          </Show>
          <Button
            size="xs"
            variant="subtle"
            onClick={() => props.resetFilters()}
            data-testid="patterns-applied-clear-all"
          >
            Clear all
          </Button>
        </ToolbarRow>
      </Box>
    </Show>
  );
}
