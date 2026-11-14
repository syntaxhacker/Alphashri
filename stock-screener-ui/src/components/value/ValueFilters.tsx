import { createSignal } from "solid-js";
import {
  ToolbarRow,
  NumberInput,
  Select,
  MultiSelect,
  Switch,
  Button,
  Modal,
  Text,
  Box,
  Divider,
} from "@/ui";
import type { ValueFilters as ValueFilterState } from "../../api/valueScan";

interface ValueFiltersProps {
  filters: ValueFilterState;
  onChange: (patch: Partial<ValueFilterState>) => void;
  sectorOptions?: string[];
}

const SORT_OPTIONS = [
  { value: "score", label: "Score ↓" },
  { value: "pe", label: "P/E ↑" },
  { value: "fcf_yield", label: "FCF% ↓" },
  { value: "dist_52w", label: "52W dist ↑" },
  { value: "roe", label: "ROE% ↓" },
];

const LIMIT_OPTIONS = [
  { value: "50", label: "50" },
  { value: "100", label: "100" },
  { value: "200", label: "200" },
];

function toNum(v: number | string | null): number | undefined {
  if (v === "" || v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

export function ValueFilters(props: ValueFiltersProps) {
  const filters = () => props.filters;
  const sectorOptions = () => props.sectorOptions ?? [];
  const [moreOpen, setMoreOpen] = createSignal(false);

  return (
    <Box data-testid="value-filters">
      <ToolbarRow data-testid="value-toolbar" gap={8}>
        <NumberInput
          placeholder="Max P/E"
          value={filters().max_pe ?? ""}
          onChange={(v: number | string) => props.onChange({ max_pe: toNum(v) })}
          w={110}
          size="sm"
          data-testid="value-filter-max-pe"
        />
        <NumberInput
          placeholder="Max P/S"
          value={filters().max_ps ?? ""}
          onChange={(v: number | string) => props.onChange({ max_ps: toNum(v) })}
          w={110}
          size="sm"
          data-testid="value-filter-max-ps"
        />
        <NumberInput
          placeholder="Min ROE%"
          value={filters().min_roe ?? ""}
          onChange={(v: number | string) => props.onChange({ min_roe: toNum(v) })}
          w={110}
          size="sm"
          data-testid="value-filter-min-roe"
        />
        <NumberInput
          placeholder="Min FCF%"
          value={filters().min_fcf_yield ?? ""}
          onChange={(v: number | string) => props.onChange({ min_fcf_yield: toNum(v) })}
          w={110}
          size="sm"
          data-testid="value-filter-min-fcf"
        />
        <Switch
          label="Above 200-DMA"
          checked={filters().above_200dma ?? false}
          onChange={(e) => props.onChange({ above_200dma: (e.currentTarget as HTMLInputElement).checked })}
          size="sm"
          data-testid="value-filter-above-200dma"
        />
        <MultiSelect
          placeholder="Sectors"
          data={sectorOptions()}
          value={filters().sectors ?? []}
          onChange={(vals) => props.onChange({ sectors: vals })}
          w={180}
          size="sm"
          data-testid="value-filter-sectors"
        />
        <Select
          placeholder="Sort"
          data={SORT_OPTIONS}
          value={filters().sort ?? "score"}
          onChange={(v) => props.onChange({ sort: v ?? undefined })}
          w={130}
          size="sm"
          data-testid="value-filter-sort"
        />
        <Select
          placeholder="Limit"
          data={LIMIT_OPTIONS}
          value={String(filters().limit ?? 100)}
          onChange={(v) => props.onChange({ limit: v ? Number(v) : undefined })}
          w={90}
          size="sm"
          data-testid="value-filter-limit"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => setMoreOpen(true)}
          data-testid="value-more-filters"
        >
          More filters
        </Button>
      </ToolbarRow>

      <Modal
        opened={moreOpen()}
        onClose={() => setMoreOpen(false)}
        title="More value filters"
        size="lg"
        data-testid="value-more-filters-modal"
      >
        <Box className="flex flex-col gap-4">
          <Box>
            <Text size="sm" fw={600}>
              Valuation
            </Text>
            <ToolbarRow gap={8}>
              <NumberInput
                label="Min P/E"
                value={filters().min_pe ?? ""}
                onChange={(v: number | string) => props.onChange({ min_pe: toNum(v) })}
                w={120}
                size="sm"
                data-testid="value-more-min-pe"
              />
              <NumberInput
                label="Max P/B"
                value={filters.max_pb ?? ""}
                onChange={(v: number | string) => props.onChange({ max_pb: toNum(v) })}
                w={120}
                size="sm"
                data-testid="value-more-max-pb"
              />
              <NumberInput
                label="Max D/E"
                value={filters.max_de ?? ""}
                onChange={(v: number | string) => props.onChange({ max_de: toNum(v) })}
                w={120}
                size="sm"
                data-testid="value-more-max-de"
              />
            </ToolbarRow>
          </Box>
          <Divider />
          <Box>
            <Text size="sm" fw={600}>
              Growth & yield
            </Text>
            <ToolbarRow gap={8}>
              <NumberInput
                label="Min rev YoY%"
                value={filters.min_rev_yoy ?? ""}
                onChange={(v: number | string) => props.onChange({ min_rev_yoy: toNum(v) })}
                w={120}
                size="sm"
                data-testid="value-more-min-rev-yoy"
              />
              <NumberInput
                label="Min EPS YoY%"
                value={filters.min_eps_yoy ?? ""}
                onChange={(v: number | string) => props.onChange({ min_eps_yoy: toNum(v) })}
                w={120}
                size="sm"
                data-testid="value-more-min-eps-yoy"
              />
              <NumberInput
                label="Min div%"
                value={filters.min_div_yield ?? ""}
                onChange={(v: number | string) => props.onChange({ min_div_yield: toNum(v) })}
                w={120}
                size="sm"
                data-testid="value-more-min-div-yield"
              />
              <NumberInput
                label="Max RSI"
                value={filters.max_rsi ?? ""}
                onChange={(v: number | string) => props.onChange({ max_rsi: toNum(v) })}
                w={120}
                size="sm"
                data-testid="value-more-max-rsi"
              />
            </ToolbarRow>
          </Box>
          <Divider />
          <Box>
            <Text size="sm" fw={600}>
              Size & liquidity
            </Text>
            <ToolbarRow gap={8}>
              <NumberInput
                label="Min mcap (B)"
                value={filters.min_mcap_bn ?? ""}
                onChange={(v: number | string) => props.onChange({ min_mcap_bn: toNum(v) })}
                w={120}
                size="sm"
                data-testid="value-more-min-mcap"
              />
              <NumberInput
                label="Max mcap (B)"
                value={filters.max_mcap_bn ?? ""}
                onChange={(v: number | string) => props.onChange({ max_mcap_bn: toNum(v) })}
                w={120}
                size="sm"
                data-testid="value-more-max-mcap"
              />
              <NumberInput
                label="Min price"
                value={filters.min_price ?? ""}
                onChange={(v: number | string) => props.onChange({ min_price: toNum(v) })}
                w={120}
                size="sm"
                data-testid="value-more-min-price"
              />
              <NumberInput
                label="Min volume"
                value={filters.min_volume ?? ""}
                onChange={(v: number | string) => props.onChange({ min_volume: toNum(v) })}
                w={120}
                size="sm"
                data-testid="value-more-min-volume"
              />
            </ToolbarRow>
          </Box>
          <Divider />
          <Box>
            <Text size="sm" fw={600}>
              Quality gates
            </Text>
            <ToolbarRow gap={16}>
              <Switch
                label="Low leverage only"
                checked={filters.require_low_de ?? false}
                onChange={(e) => props.onChange({ require_low_de: (e.currentTarget as HTMLInputElement).checked })}
                size="sm"
                data-testid="value-more-require-low-de"
              />
              <Switch
                label="Positive FCF"
                checked={filters.exclude_negative_fcf ?? false}
                onChange={(e) => props.onChange({ exclude_negative_fcf: (e.currentTarget as HTMLInputElement).checked })}
                size="sm"
                data-testid="value-more-exclude-negative-fcf"
              />
              <Switch
                label="Positive EPS"
                checked={filters.exclude_negative_eps ?? false}
                onChange={(e) => props.onChange({ exclude_negative_eps: (e.currentTarget as HTMLInputElement).checked })}
                size="sm"
                data-testid="value-more-exclude-negative-eps"
              />
              <Switch
                label="Exclude loss-making"
                checked={filters.exclude_loss_making ?? false}
                onChange={(e) => props.onChange({ exclude_loss_making: (e.currentTarget as HTMLInputElement).checked })}
                size="sm"
                data-testid="value-more-exclude-loss-making"
              />
            </ToolbarRow>
          </Box>
        </Box>
      </Modal>
    </Box>
  );
}
