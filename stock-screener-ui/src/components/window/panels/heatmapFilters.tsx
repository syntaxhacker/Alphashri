import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Badge, Box, Button, Checkbox, Divider, NumberInput, Portal, ScrollArea, Text } from "@/ui";
import type { MarketRow, MarketUniverse } from "@/types/marketScreener";
import {
  capTierOptions,
  countActiveMarketFilters,
  defaultMarketFilters,
  marketSectors,
  type MarketFilterState,
} from "../../market/marketFilters";

const POPOVER_WIDTH = 268;
const EDGE_GAP = 8;

function bound(value: number | string): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export interface HeatmapFiltersControlProps {
  filters: MarketFilterState;
  rows: MarketRow[];
  universe: MarketUniverse;
  onChange: (patch: Partial<MarketFilterState>) => void;
}

/**
 * Window-local filter affordance. The page rail owns the full filter set; this
 * carries only the four questions worth asking in a 740px floating window:
 * class/size, sector, day movers and unusual participation.
 */
export function HeatmapFiltersControl(props: HeatmapFiltersControlProps) {
  const [open, setOpen] = createSignal(false);
  const [placement, setPlacement] = createSignal({ top: 0, left: 0 });
  let buttonEl: HTMLElement | undefined;
  let popoverEl: HTMLDivElement | undefined;

  const activeCount = createMemo(() => countActiveMarketFilters(props.filters, props.universe));
  const tiers = createMemo(() => capTierOptions(props.universe));
  const sectors = createMemo(() => marketSectors(props.rows));

  const place = () => {
    const rect = buttonEl?.getBoundingClientRect();
    if (!rect) return;
    const top = rect.bottom + EDGE_GAP;
    const left = Math.max(
      EDGE_GAP,
      Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - EDGE_GAP),
    );
    setPlacement((prev) => (prev.top === top && prev.left === left ? prev : { top, left }));
  };

  const close = () => {
    setOpen(false);
    buttonEl?.focus();
  };

  const toggle = (event: MouseEvent) => {
    buttonEl = event.currentTarget as HTMLElement;
    if (open()) {
      close();
      return;
    }
    place();
    setOpen(true);
  };

  createEffect(() => {
    if (!open()) return;
    place();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonEl?.contains(target) || popoverEl?.contains(target)) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", place);
    onCleanup(() => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", place);
    });
  });

  const toggleTier = (tier: string, checked: boolean) => {
    const next = new Set(props.filters.capTiers);
    if (checked) next.add(tier);
    else next.delete(tier);
    props.onChange({ capTiers: next });
  };

  const toggleSector = (sector: string, checked: boolean) => {
    const next = new Set(props.filters.sectors);
    if (checked) next.add(sector);
    else next.delete(sector);
    props.onChange({ sectors: [...next] });
  };

  const labelClass = "text-[10px] uppercase tracking-[0.06em] text-fin-text-muted";

  return (
    <>
      <Button
        size="xs"
        variant="subtle"
        data-testid="heatmap-filters-button"
        data-heatmap-filter-anchor
        aria-label={`Filters (${activeCount()})`}
        aria-haspopup="dialog"
        aria-expanded={open()}
        onClick={toggle}
      >
        <span>Filters </span>
        <Badge size="xs" color={activeCount() > 0 ? "primary" : "dimmed"} data-testid="heatmap-filter-badge">
          ({activeCount()})
        </Badge>
        <span aria-hidden="true"> ▾</span>
      </Button>

      <Show when={open()}>
        <Portal>
          <div
            ref={(el) => {
              popoverEl = el;
              // The window is overflow-hidden: this node is portalled to <body>
              // and fixed so the frame's clip never eats the dropdown.
              queueMicrotask(() => {
                (el.querySelector<HTMLElement>("[data-heatmap-filter-first]") ?? el).focus();
              });
            }}
            role="dialog"
            aria-label="Heatmap filters"
            tabIndex={-1}
            data-testid="heatmap-filters-popover"
            className="z-50 flex flex-col gap-2 rounded-[6px] border border-fin-border bg-fin-surface p-2 shadow-lg"
            style={{
              position: "fixed",
              top: `${placement().top}px`,
              left: `${placement().left}px`,
              width: `${POPOVER_WIDTH}px`,
            }}
          >
            <Box className="flex items-center justify-between gap-2">
              <Text size="xs" fw={700}>Filters</Text>
              <Show when={activeCount() > 0}>
                <Button
                  size="xs"
                  variant="subtle"
                  data-testid="heatmap-filter-reset"
                  onClick={() => props.onChange({ ...defaultMarketFilters(props.universe) })}
                >
                  Clear
                </Button>
              </Show>
            </Box>

            <Box className="flex flex-col gap-1" role="group" aria-label="Cap tier">
              <Text size="xs" c="dimmed" className={labelClass}>Cap tier</Text>
              <Box className="flex flex-wrap gap-x-3 gap-y-1">
                <For each={tiers()}>
                  {(tier, index) => (
                    <Checkbox
                      size="xs"
                      label={tier.label}
                      checked={props.filters.capTiers.has(tier.value)}
                      onChange={(event) => toggleTier(tier.value, (event.currentTarget as HTMLInputElement).checked)}
                      data-testid={`heatmap-filter-cap-${tier.value}`}
                      {...(index() === 0 ? { "data-heatmap-filter-first": true } : {})}
                    />
                  )}
                </For>
              </Box>
            </Box>

            <Box className="flex flex-col gap-1" role="group" aria-label="Sector">
              <Text size="xs" c="dimmed" className={labelClass}>Sector</Text>
              <ScrollArea className="max-h-[132px] pr-1">
                <Show
                  when={sectors().length > 0}
                  fallback={<Text size="xs" c="dimmed">No sectors in this snapshot.</Text>}
                >
                  <Box className="flex flex-col gap-1">
                    <For each={sectors()}>
                      {(sector) => (
                        <Checkbox
                          size="xs"
                          label={sector}
                          checked={props.filters.sectors.includes(sector)}
                          onChange={(event) => toggleSector(sector, (event.currentTarget as HTMLInputElement).checked)}
                          data-testid={`heatmap-filter-sector-option-${sector}`}
                        />
                      )}
                    </For>
                  </Box>
                </Show>
              </ScrollArea>
            </Box>

            <Divider />

            <Box className="flex flex-col gap-1" role="group" aria-label="Day change range">
              <Text size="xs" c="dimmed" className={labelClass}>Day change %</Text>
              <Box className="flex items-center gap-2">
                <NumberInput
                  size="xs"
                  hideControls
                  w={104}
                  placeholder="Min"
                  aria-label="Minimum day change percent"
                  value={props.filters.dayChangeMin ?? ""}
                  onChange={(value) => props.onChange({ dayChangeMin: bound(value) })}
                  data-testid="heatmap-filter-day-min"
                />
                <NumberInput
                  size="xs"
                  hideControls
                  w={104}
                  placeholder="Max"
                  aria-label="Maximum day change percent"
                  value={props.filters.dayChangeMax ?? ""}
                  onChange={(value) => props.onChange({ dayChangeMax: bound(value) })}
                  data-testid="heatmap-filter-day-max"
                />
              </Box>
            </Box>

            <Box className="flex flex-col gap-1" role="group" aria-label="Relative volume">
              <Text size="xs" c="dimmed" className={labelClass}>Rel volume min</Text>
              <NumberInput
                size="xs"
                hideControls
                w={104}
                placeholder="e.g. 1.5"
                aria-label="Minimum relative volume"
                value={props.filters.relVolMin ?? ""}
                onChange={(value) => props.onChange({ relVolMin: bound(value) })}
                data-testid="heatmap-filter-relvol-min"
              />
            </Box>
          </div>
        </Portal>
      </Show>
    </>
  );
}
