import { For, Show } from "solid-js";
import {
  Box,
  Checkbox,
  Divider,
  Select,
  Switch,
  Text,
  ActionIcon,
  Tooltip,
} from "@/ui";
import { IconChevronLeft, IconFilter } from "../common/Icons";
import { RangeInput } from "../common/RangeInput";
import {
  CAP_TIERS,
  CAP_TIER_LABELS,
  MARKET_SORT_OPTIONS,
  type MarketFilterState,
  type MarketSortKey,
} from "./marketFilters";

const SECTOR_ALL = "__all__";

export interface MarketFilterRailProps {
  filters: MarketFilterState;
  onChange: (patch: Partial<MarketFilterState>) => void;
  /** Alphabetically sorted distinct sectors from the loaded snapshot. */
  sectors: string[];
  /** Rows per cap tier, for the checkbox labels. */
  tierCounts?: Record<string, number>;
  /** Renders a collapse affordance in the rail header (desktop rail). */
  onCollapse?: () => void;
  /** Accessible label for the collapse button (desktop "collapse" / drawer "close"). */
  collapseLabel?: string;
}


function SectionTitle(props: { children?: string }) {
  return (
    <Text
      size="xs"
      fw={700}
      c="dimmed"
      className="text-[10px] uppercase tracking-[0.5px]"
    >
      {props.children}
    </Text>
  );
}

export function MarketFilterRail(props: MarketFilterRailProps) {
  const filters = () => props.filters;
  const tierCounts = () => props.tierCounts;
  const collapseLabel = () => props.collapseLabel ?? "Collapse filters";

  const toggleTier = (tier: string, checked: boolean): void => {
    const next = new Set(filters().capTiers);
    if (checked) next.add(tier);
    else next.delete(tier);
    props.onChange({ capTiers: next });
  };

  return (
    <Box
      data-testid="market-filter-rail"
      className="flex flex-col gap-2 p-2"
    >
      <Box className="flex items-center justify-between">
        <Box className="flex items-center gap-1">
          <IconFilter size={12} />
          <Text size="xs" fw={700}>
            Filters
          </Text>
        </Box>
        <Show when={props.onCollapse}>
          <Tooltip label={collapseLabel()}>
            <span>
              <ActionIcon
                variant="subtle"
                size="sm"
                onClick={() => props.onCollapse?.()}
                data-testid="market-rail-collapse"
              >
                <IconChevronLeft size={14} />
              </ActionIcon>
            </span>
          </Tooltip>
        </Show>
      </Box>

      <SectionTitle>Cap tier</SectionTitle>
      <Box className="flex flex-col gap-0.5">
        <For each={CAP_TIERS}>{(tier) => {
          const count = tierCounts()?.[tier];
          const label = count !== undefined ? `${CAP_TIER_LABELS[tier]} (${count})` : CAP_TIER_LABELS[tier];
          return (
            <Checkbox
              size="xs"
              label={label}
              checked={filters().capTiers.has(tier)}
              onChange={(e) => toggleTier(tier, (e.currentTarget as HTMLInputElement).checked)}
              data-testid={`market-cap-${tier}`}
            />
          );
        }}</For>
      </Box>

      <Divider />
      <RangeInput
        label="Price ₹"
        min={filters().priceMin ?? null}
        max={filters().priceMax ?? null}
        onMinChange={(v) => props.onChange({ priceMin: v })}
        onMaxChange={(v) => props.onChange({ priceMax: v })}
        domain={[0, 10000]}
        step={10}
        formatValue={(v) => `₹${v}`}
        testId="market-filter-price"
      />

      <RangeInput
        label="Day change %"
        min={filters().dayChangeMin ?? null}
        max={filters().dayChangeMax ?? null}
        onMinChange={(v) => props.onChange({ dayChangeMin: v })}
        onMaxChange={(v) => props.onChange({ dayChangeMax: v })}
        domain={[-20, 20]}
        step={0.5}
        formatValue={(v) => `${v > 0 ? "+" : ""}${v}%`}
        marks={[
          { value: -20, label: "-20" },
          { value: 0, label: "0" },
          { value: 20, label: "+20" },
        ]}
        testId="market-filter-day"
      />

      <RangeInput
        label="Market cap ₹ Cr"
        min={filters().mcapMinCr ?? null}
        max={filters().mcapMaxCr ?? null}
        onMinChange={(v) => props.onChange({ mcapMinCr: v })}
        onMaxChange={(v) => props.onChange({ mcapMaxCr: v })}
        domain={[0, 500000]}
        step={1000}
        formatValue={(v) => `₹${Math.round(v / 1000)}k Cr`}
        testId="market-filter-mcap"
      />

      <Divider />
      <RangeInput
        label="RSI"
        min={filters().rsiMin ?? null}
        max={filters().rsiMax ?? null}
        onMinChange={(v) => props.onChange({ rsiMin: v })}
        onMaxChange={(v) => props.onChange({ rsiMax: v })}
        domain={[0, 100]}
        marks={[
          { value: 0, label: "0" },
          { value: 30, label: "30" },
          { value: 70, label: "70" },
          { value: 100, label: "100" },
        ]}
        testId="market-filter-rsi"
      />

      <RangeInput
        label="Relative volume"
        min={filters().relVolMin ?? null}
        max={filters().relVolMax ?? null}
        onMinChange={(v) => props.onChange({ relVolMin: v })}
        onMaxChange={(v) => props.onChange({ relVolMax: v })}
        domain={[0, 10]}
        step={0.1}
        formatValue={(v) => `${v.toFixed(1)}x`}
        testId="market-filter-relvol"
      />

      <Divider />
      <SectionTitle>Trend</SectionTitle>
      <Box className="flex flex-col gap-0.5">
        <Switch
          size="xs"
          label="Above SMA 20"
          checked={filters().aboveSma20}
          onChange={(e) => props.onChange({ aboveSma20: (e.currentTarget as HTMLInputElement).checked })}
          data-testid="market-filter-above-sma20"
        />
        <Switch
          size="xs"
          label="Above SMA 50"
          checked={filters().aboveSma50}
          onChange={(e) => props.onChange({ aboveSma50: (e.currentTarget as HTMLInputElement).checked })}
          data-testid="market-filter-above-sma50"
        />
        <Switch
          size="xs"
          label="Above SMA 200"
          checked={filters().aboveSma200}
          onChange={(e) => props.onChange({ aboveSma200: (e.currentTarget as HTMLInputElement).checked })}
          data-testid="market-filter-above-sma200"
        />
      </Box>

      <Divider />
      <SectionTitle>Instrument</SectionTitle>
      <Box className="flex flex-col gap-0.5">
        <Switch
          size="xs"
          label="F&O only"
          checked={filters().fnoOnly}
          onChange={(e) => props.onChange({ fnoOnly: (e.currentTarget as HTMLInputElement).checked })}
          data-testid="market-filter-fno"
        />
        <Switch
          size="xs"
          label="ETF only"
          checked={filters().etfOnly}
          onChange={(e) => props.onChange({ etfOnly: (e.currentTarget as HTMLInputElement).checked })}
          data-testid="market-filter-etf"
        />
      </Box>

      <Divider />
      <SectionTitle>Sector</SectionTitle>
      <Select
        size="xs"
        data={[
          { value: SECTOR_ALL, label: "All sectors" },
          ...props.sectors.map((s) => ({ value: s, label: s })),
        ]}
        value={filters().sector ?? SECTOR_ALL}
        onChange={(v) => props.onChange({ sector: !v || v === SECTOR_ALL ? null : v })}
        aria-label="Sector"
        data-testid="market-filter-sector"
      />

      <SectionTitle>Sort by</SectionTitle>
      <Select
        size="xs"
        data={MARKET_SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        value={filters().sort}
        onChange={(v) => v && props.onChange({ sort: v as MarketSortKey })}
        aria-label="Sort rows"
        data-testid="market-filter-sort"
      />
    </Box>
  );
}
