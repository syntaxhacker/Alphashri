import { createSignal, For, Show, type JSX } from "solid-js";
import {
  Box,
  Checkbox,
  Divider,
  MultiSelect,
  Switch,
  Text,
  ActionIcon,
  Indicator,
  Tooltip,
  useDisclosure,
} from "@/ui";
import {
  IconChevronLeft,
  IconChevronRight,
  IconCurrencyDollar,
  IconFilter,
  IconSparkles,
} from "../common/Icons";
import { RangeInput } from "../common/RangeInput";
import { currencyFor, type CurrencyCode } from "@/config/currency";
import { descriptorForCurrency } from "@/config/marketUniverses";
import {
  activeMoverPreset,
  capTierOptions,
  universeHasFno,
  type MarketFilterState,
} from "./marketFilters";
import { PresetGallery } from "./presets/PresetGallery";
import { VALUE_FIELDS } from "./presets/presetFields";

/** One size for every band label in the rail — header included. */
const SECTION_LABEL = "text-ui-micro uppercase tracking-[0.06em]";

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
  /** Quote currency of the current universe. Defaults to India so callers are unchanged. */
  currency?: CurrencyCode;
  /** Portal the preset dialog to `<body>` when this rail sits inside a transformed drawer. */
  portalGallery?: boolean;
}

/**
 * India's cap bound reads in thousands of crore (the legacy compact label);
 * USD reads straight in billions. The unit always travels with the currency so
 * a US bound can never acquire a crore suffix.
 */
export function formatRailMcap(value: number, currency?: CurrencyCode): string {
  const spec = currencyFor(currency);
  if (spec.code === "INR") {
    return `${spec.symbol}${Math.round(value / 1000)}k ${spec.mcapSuffix}`;
  }
  return `${spec.symbol}${value}${spec.mcapSuffix}`;
}

export function railPriceLabel(currency?: CurrencyCode): string {
  return `Price ${currencyFor(currency).symbol}`;
}

/** US rows are outside the NSE/BSE F&O universe, so the F&O affordance is India-only. */
export function hasFnoAffordance(currency?: CurrencyCode): boolean {
  return universeHasFno(descriptorForCurrency(currency).value);
}

export function formatRailPrice(value: number, currency?: CurrencyCode): string {
  return `${currencyFor(currency).symbol}${value}`;
}

function SectionTitle(props: { children?: string }) {
  // Deliberately no `size`: Text writes `size` as an inline font-size, which
  // would beat the 10px class and leave the bands at two different sizes.
  return (
    <Text component="h3" fw={600} c="dimmed" className={SECTION_LABEL}>
      {props.children}
    </Text>
  );
}

/** A titled band: 4px from its title to the first control, 8px between controls. */
function RailSection(props: { title: string; children?: JSX.Element }) {
  return (
    <Box role="group" aria-label={props.title} className="flex flex-col gap-1">
      <SectionTitle>{props.title}</SectionTitle>
      <Box className="flex flex-col gap-2">{props.children}</Box>
    </Box>
  );
}

/** Toggles of one kind read as a single control, so they sit tighter than two controls. */
function ToggleGroup(props: { children?: JSX.Element }) {
  return <Box className="flex flex-col gap-1">{props.children}</Box>;
}

export function MarketFilterRail(props: MarketFilterRailProps) {
  const filters = () => props.filters;
  // One modal owns every preset and every advanced bound. The rail keeps only
  // two compact entry points, so the 390px filter drawer no longer scrolls to
  // reach the presets (and the fields never push the table below the fold).
  const [galleryOpened, gallery] = useDisclosure(false);
  const [focusSection, setFocusSection] = createSignal<"value" | "movers">("value");
  const openGallery = (section: "value" | "movers"): void => {
    setFocusSection(section);
    gallery.open();
  };
  // Hidden fields still narrow the table — the entry button has to say so.
  const valueActiveCount = () => VALUE_FIELDS.filter((f) => filters()[f.key as keyof MarketFilterState] != null).length;
  const moverActive = () => activeMoverPreset(filters());
  const tierCounts = () => props.tierCounts;
  const collapseLabel = () => props.collapseLabel ?? "Collapse filters";
  const universe = () => descriptorForCurrency(props.currency).value;
  const capTierOpts = () => capTierOptions(descriptorForCurrency(props.currency).value);
  // Class tiers are not rungs above micro: keep them out of the size ladder so
  // the size checkboxes stay a contiguous, descending ladder. The split reads
  // each descriptor entry's own flag, so a new class tier needs no rail edit.
  const sizeTierOpts = () => capTierOpts().filter((t) => !t.category);
  const categoryTierOpts = () => capTierOpts().filter((t) => t.category);

  // Read inside the JSX prop, not once per <For> item: a snapshot refresh (or an
  // India → US hydration) replaces tierCounts without recreating the options,
  // and a captured string would keep printing the previous universe's counts.
  const tierLabel = (tier: { value: string; label: string }): string => {
    const count = tierCounts()?.[tier.value];
    return count !== undefined ? `${tier.label} (${count})` : tier.label;
  };

  const toggleTier = (tier: { value: string }, checked: boolean): void => {
    const next = new Set(filters().capTiers);
    if (checked) next.add(tier.value);
    else next.delete(tier.value);
    props.onChange({ capTiers: next });
  };

  return (
    <Box
      data-testid="market-filter-rail"
      className="flex flex-col gap-3 p-2 w-full max-w-full min-w-0 overflow-x-hidden"
    >
      <Box className="flex items-center justify-between">
        <Box className="flex items-center gap-1">
          <IconFilter size={12} />
          <Text fw={700} className={SECTION_LABEL}>
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
                aria-label={collapseLabel()}
                data-testid="market-rail-collapse"
              >
                <IconChevronLeft size={14} />
              </ActionIcon>
            </span>
          </Tooltip>
        </Show>
      </Box>

      <RailSection title="Price & size">
        <RangeInput
          label={railPriceLabel(props.currency)}
          min={filters().priceMin ?? null}
          max={filters().priceMax ?? null}
          onMinChange={(v) => props.onChange({ priceMin: v })}
          onMaxChange={(v) => props.onChange({ priceMax: v })}
          domain={[0, 10000]}
          step={10}
          formatValue={(v) => formatRailPrice(v, props.currency)}
          commitOnRelease
          testId="market-filter-price"
        />

        <RangeInput
          label="Mkt cap"
          min={filters().mcapMinCr ?? null}
          max={filters().mcapMaxCr ?? null}
          onMinChange={(v) => props.onChange({ mcapMinCr: v })}
          onMaxChange={(v) => props.onChange({ mcapMaxCr: v })}
          domain={[0, 500000]}
          step={1000}
          formatValue={(v) => formatRailMcap(v, props.currency)}
          commitOnRelease
          testId="market-filter-mcap"
        />

        <ToggleGroup>
          <For each={sizeTierOpts()}>{(tier) => (
            <Checkbox
              size="xs"
              label={tierLabel(tier)}
              checked={filters().capTiers.has(tier.value)}
              onChange={(checked) => toggleTier(tier, checked)}
              data-testid={`market-cap-${tier.value}`}
            />
          )}</For>
        </ToggleGroup>

        <Show when={categoryTierOpts().length > 0}>
          <Box className="flex flex-col gap-1 pt-1">
            <Text fw={600} c="dimmed" className={SECTION_LABEL}>
              Instrument class
            </Text>
            <ToggleGroup>
              <For each={categoryTierOpts()}>{(tier) => (
                <Checkbox
                  size="xs"
                  label={tierLabel(tier)}
                  checked={filters().capTiers.has(tier.value)}
                  onChange={(checked) =>
                    toggleTier(tier, checked)
                  }
                  data-testid={`market-cap-${tier.value}`}
                />
              )}</For>
            </ToggleGroup>
          </Box>
        </Show>
      </RailSection>

      <Divider />

      <RailSection title="Momentum">
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
          commitOnRelease
          testId="market-filter-day"
        />

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
          commitOnRelease
          testId="market-filter-rsi"
        />

        <RangeInput
          label="Rel vol"
          min={filters().relVolMin ?? null}
          max={filters().relVolMax ?? null}
          onMinChange={(v) => props.onChange({ relVolMin: v })}
          onMaxChange={(v) => props.onChange({ relVolMax: v })}
          domain={[0, 10]}
          step={0.1}
          formatValue={(v) => `${v.toFixed(1)}x`}
          commitOnRelease
          testId="market-filter-relvol"
        />
      </RailSection>

      <Divider />

      {/* The value band is now a gallery entry, not a stack of twelve inputs.
          The active count stays on the rail so a hidden gate is never invisible. */}
      <button
        type="button"
        data-testid="market-value-toggle"
        aria-haspopup="dialog"
        aria-expanded={galleryOpened() && focusSection() === "value"}
        onClick={() => openGallery("value")}
        className="flex min-h-6 items-center justify-between w-full min-w-0 -mx-1 px-1 rounded-sm cursor-pointer text-fin-text hover:bg-fin-surface-alt focus-visible:outline focus-visible:outline-1 focus-visible:outline-fin-primary"
      >
        <Box className="flex items-center gap-1 min-w-0">
          <IconCurrencyDollar size={12} />
          <Text fw={600} className="text-ui-micro whitespace-nowrap">
            Value filters
          </Text>
          <Show when={valueActiveCount() > 0}>
            <Indicator label={String(valueActiveCount())} color="primary" size={12} />
          </Show>
        </Box>
        <IconChevronRight size={12} />
      </button>

      <Divider />

      {/* Each mover replaces bounds + sort. The gallery shows the whole set
          with its thesis and chips instead of twelve bare buttons on the rail. */}
      <button
        type="button"
        data-testid="market-movers-toggle"
        aria-haspopup="dialog"
        aria-expanded={galleryOpened() && focusSection() === "movers"}
        onClick={() => openGallery("movers")}
        className="flex min-h-6 items-center justify-between w-full min-w-0 -mx-1 px-1 rounded-sm cursor-pointer text-fin-text hover:bg-fin-surface-alt focus-visible:outline focus-visible:outline-1 focus-visible:outline-fin-primary"
      >
        <Box className="flex items-center gap-1 min-w-0">
          <IconSparkles size={12} />
          <Text fw={600} className="text-ui-micro whitespace-nowrap">
            Mover presets
          </Text>
          <Show when={moverActive()}>
            <Indicator label="1" color="primary" size={12} />
          </Show>
        </Box>
        <IconChevronRight size={12} />
      </button>

      <Divider />

      <RailSection title="Trend">
        <ToggleGroup>
          <Switch
            size="xs"
            label="Above SMA 20"
            checked={filters().aboveSma20}
            onChange={(checked) => props.onChange({ aboveSma20: checked })}
            data-testid="market-filter-above-sma20"
          />
          <Switch
            size="xs"
            label="Above SMA 50"
            checked={filters().aboveSma50}
            onChange={(checked) => props.onChange({ aboveSma50: checked })}
            data-testid="market-filter-above-sma50"
          />
          <Switch
            size="xs"
            label="Above SMA 200"
            checked={filters().aboveSma200}
            onChange={(checked) => props.onChange({ aboveSma200: checked })}
            data-testid="market-filter-above-sma200"
          />
        </ToggleGroup>
      </RailSection>

      <Show when={hasFnoAffordance(props.currency)}>
        <Divider />
        <RailSection title="Instrument">
          <ToggleGroup>
            <Switch
              size="xs"
              label="F&O only"
              checked={filters().fnoOnly}
              onChange={(checked) => props.onChange({ fnoOnly: checked })}
              data-testid="market-filter-fno"
            />
          </ToggleGroup>
        </RailSection>
      </Show>

      <Divider />

      <RailSection title="Sector">
        <MultiSelect
          size="xs"
          data={props.sectors}
          value={filters().sectors}
          onChange={(v) => props.onChange({ sectors: v })}
          placeholder="All sectors"
          clearable
          searchable
          aria-label="Sectors"
          data-testid="market-filter-sector"
        />
      </RailSection>

      <PresetGallery
        opened={galleryOpened()}
        onClose={gallery.close}
        filters={filters()}
        onChange={props.onChange}
        focus={focusSection()}
        universe={universe()}
        currency={props.currency}
        portal={props.portalGallery}
      />
    </Box>
  );
}