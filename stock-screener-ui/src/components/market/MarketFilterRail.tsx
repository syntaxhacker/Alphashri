import {
  Box,
  Checkbox,
  Divider,
  NumberInput,
  Select,
  Switch,
  Text,
  ActionIcon,
  Tooltip,
} from "@/ui";
import { IconChevronLeft, IconFilter } from "@tabler/icons-react";
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

const toNum = (v: number | string): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function SectionTitle({ children }: { children: string }) {
  return (
    <Text
      size="xs"
      fw={700}
      c="dimmed"
      sx={{ letterSpacing: 0.5, textTransform: "uppercase", fontSize: 10 }}
    >
      {children}
    </Text>
  );
}

export function MarketFilterRail({
  filters,
  onChange,
  sectors,
  tierCounts,
  onCollapse,
  collapseLabel = "Collapse filters",
}: MarketFilterRailProps) {
  const toggleTier = (tier: string, checked: boolean): void => {
    const next = new Set(filters.capTiers);
    if (checked) next.add(tier);
    else next.delete(tier);
    onChange({ capTiers: next });
  };

  const sectorValue = filters.sector ?? SECTOR_ALL;

  return (
    <Box
      data-testid="market-filter-rail"
      sx={{ display: "flex", flexDirection: "column", gap: 1, p: 1 }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <IconFilter size={12} />
          <Text size="xs" fw={700}>
            Filters
          </Text>
        </Box>
        {onCollapse ? (
          <Tooltip label={collapseLabel}>
            <span>
              <ActionIcon
                variant="subtle"
                size="sm"
                onClick={onCollapse}
                data-testid="market-rail-collapse"
              >
                <IconChevronLeft size={14} />
              </ActionIcon>
            </span>
          </Tooltip>
        ) : null}
      </Box>

      <SectionTitle>Cap tier</SectionTitle>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
        {CAP_TIERS.map((tier) => {
          const count = tierCounts?.[tier];
          const label = count !== undefined ? `${CAP_TIER_LABELS[tier]} (${count})` : CAP_TIER_LABELS[tier];
          return (
            <Checkbox
              key={tier}
              size="xs"
              label={label}
              checked={filters.capTiers.has(tier)}
              onChange={(e) => toggleTier(tier, e.currentTarget.checked)}
              data-testid={`market-cap-${tier}`}
            />
          );
        })}
      </Box>

      <Divider />
      <SectionTitle>Price ₹</SectionTitle>
      <Box sx={{ display: "flex", gap: 0.5 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <NumberInput
            placeholder="Min"
            aria-label="Minimum price"
            value={filters.priceMin ?? ""}
            onChange={(v: number | string) => onChange({ priceMin: toNum(v) })}
            size="xs"
            style={{ width: "100%" }}
            min={0}
            data-testid="market-filter-price-min"
          />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <NumberInput
            placeholder="Max"
            aria-label="Maximum price"
            value={filters.priceMax ?? ""}
            onChange={(v: number | string) => onChange({ priceMax: toNum(v) })}
            size="xs"
            style={{ width: "100%" }}
            min={0}
            data-testid="market-filter-price-max"
          />
        </Box>
      </Box>

      <SectionTitle>Day change %</SectionTitle>
      <Box sx={{ display: "flex", gap: 0.5 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <NumberInput
            placeholder="Min %"
            aria-label="Minimum day change percent"
            value={filters.dayChangeMin ?? ""}
            onChange={(v: number | string) => onChange({ dayChangeMin: toNum(v) })}
            size="xs"
            style={{ width: "100%" }}
            data-testid="market-filter-day-min"
          />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <NumberInput
            placeholder="Max %"
            aria-label="Maximum day change percent"
            value={filters.dayChangeMax ?? ""}
            onChange={(v: number | string) => onChange({ dayChangeMax: toNum(v) })}
            size="xs"
            style={{ width: "100%" }}
            data-testid="market-filter-day-max"
          />
        </Box>
      </Box>

      <SectionTitle>Market cap</SectionTitle>
      <NumberInput
        placeholder="Min MCap (₹ Cr)"
        aria-label="Minimum market cap in crore"
        min={0}
        value={filters.mcapMinCr ?? ""}
        onChange={(v: number | string) => onChange({ mcapMinCr: toNum(v) })}
        size="xs"
        data-testid="market-filter-mcap-min"
      />

      <Divider />
      <SectionTitle>RSI</SectionTitle>
      <Box sx={{ display: "flex", gap: 0.5 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <NumberInput
            placeholder="Min"
            aria-label="Minimum RSI"
            min={0}
            max={100}
            value={filters.rsiMin ?? ""}
            onChange={(v: number | string) => onChange({ rsiMin: toNum(v) })}
            size="xs"
            style={{ width: "100%" }}
            data-testid="market-filter-rsi-min"
          />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <NumberInput
            placeholder="Max"
            aria-label="Maximum RSI"
            min={0}
            max={100}
            value={filters.rsiMax ?? ""}
            onChange={(v: number | string) => onChange({ rsiMax: toNum(v) })}
            size="xs"
            style={{ width: "100%" }}
            data-testid="market-filter-rsi-max"
          />
        </Box>
      </Box>

      <SectionTitle>Relative volume</SectionTitle>
      <NumberInput
        placeholder="Min rel-vol (x)"
        aria-label="Minimum relative volume"
        min={0}
        step={0.1}
        value={filters.relVolMin ?? ""}
        onChange={(v: number | string) => onChange({ relVolMin: toNum(v) })}
        size="xs"
        data-testid="market-filter-relvol-min"
      />

      <Divider />
      <SectionTitle>Trend</SectionTitle>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
        <Switch
          size="xs"
          label="Above SMA 20"
          checked={filters.aboveSma20}
          onChange={(e) => onChange({ aboveSma20: e.currentTarget.checked })}
          data-testid="market-filter-above-sma20"
        />
        <Switch
          size="xs"
          label="Above SMA 50"
          checked={filters.aboveSma50}
          onChange={(e) => onChange({ aboveSma50: e.currentTarget.checked })}
          data-testid="market-filter-above-sma50"
        />
        <Switch
          size="xs"
          label="Above SMA 200"
          checked={filters.aboveSma200}
          onChange={(e) => onChange({ aboveSma200: e.currentTarget.checked })}
          data-testid="market-filter-above-sma200"
        />
      </Box>

      <Divider />
      <SectionTitle>Instrument</SectionTitle>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
        <Switch
          size="xs"
          label="F&O only"
          checked={filters.fnoOnly}
          onChange={(e) => onChange({ fnoOnly: e.currentTarget.checked })}
          data-testid="market-filter-fno"
        />
        <Switch
          size="xs"
          label="ETF only"
          checked={filters.etfOnly}
          onChange={(e) => onChange({ etfOnly: e.currentTarget.checked })}
          data-testid="market-filter-etf"
        />
      </Box>

      <Divider />
      <SectionTitle>Sector</SectionTitle>
      <Select
        size="xs"
        data={[
          { value: SECTOR_ALL, label: "All sectors" },
          ...sectors.map((s) => ({ value: s, label: s })),
        ]}
        value={sectorValue}
        onChange={(v) => onChange({ sector: !v || v === SECTOR_ALL ? null : v })}
        aria-label="Sector"
        data-testid="market-filter-sector"
      />

      <SectionTitle>Sort by</SectionTitle>
      <Select
        size="xs"
        data={MARKET_SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        value={filters.sort}
        onChange={(v) => v && onChange({ sort: v as MarketSortKey })}
        aria-label="Sort rows"
        data-testid="market-filter-sort"
      />
    </Box>
  );
}
