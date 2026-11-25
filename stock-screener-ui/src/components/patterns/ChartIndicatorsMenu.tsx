import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { Button, Checkbox, Text } from "@/ui";
import { IconActivity } from "@/ui/icons";
import type { ChartIndicators, SRZone } from "@/types/chartPatterns";
import {
  CHART_INDICATOR_GROUPS,
  CHART_INDICATOR_SPECS,
  chartIndicatorAvailability,
  activeChartIndicatorSpecs,
  type ChartIndicatorGroup,
  type ChartIndicatorId,
  type ChartIndicatorSpec,
} from "@/config/chartIndicators";
import {
  chartIndicatorPrefs,
  resetChartIndicatorPrefs,
  setChartIndicator,
} from "@/state/chartIndicators";
import type { JSX } from "solid-js";

export interface ChartIndicatorsMenuProps {
  timeframe?: string | null;
  candleCount?: number | null;
  indicators?: ChartIndicators | null;
  srZones?: SRZone[] | null;
  /** Drawable series from the chart data; wins over payload sniffing. */
  presentIndicatorIds?: ReadonlySet<ChartIndicatorId> | null;
  /** Compact 28px trigger for narrow chart columns. */
  compact?: boolean;
}

/** Dashed/dotted rows read as a line sample, not a solid block. */
function sampleStyle(spec: ChartIndicatorSpec): JSX.CSSProperties {
  return {
    width: "18px",
    height: "0",
    "border-top": `2px ${spec.dash} ${spec.color}`,
  };
}

function GroupHeading(props: { group: ChartIndicatorGroup }) {
  return (
    <Text
      size="xs"
      fw={700}
      c="dimmed"
      className="px-1 text-ui-micro uppercase tracking-[0.5px]"
      data-testid={`chart-indicators-group-${props.group.toLowerCase()}`}
    >
      {props.group}
    </Text>
  );
}

export function ChartIndicatorsMenu(props: ChartIndicatorsMenuProps) {
  const [open, setOpen] = createSignal(false);
  let rootEl: HTMLDivElement | undefined;

  const ctx = createMemo(() => ({
    timeframe: props.timeframe ?? null,
    candleCount: props.candleCount ?? 0,
    indicators: props.indicators ?? null,
    srZoneCount: props.srZones?.length ?? 0,
    presentIndicatorIds: props.presentIndicatorIds ?? null,
  }));

  const prefs = chartIndicatorPrefs;
  const availabilityFor = (spec: ChartIndicatorSpec) => chartIndicatorAvailability(spec.id, ctx());
  const activeCount = createMemo(() => activeChartIndicatorSpecs(prefs(), ctx()).length);
  const resetDirty = createMemo(() =>
    CHART_INDICATOR_SPECS.some((spec) => prefs()[spec.id] !== spec.defaultEnabled),
  );
  const groupSpecs = (group: ChartIndicatorGroup) =>
    CHART_INDICATOR_SPECS.filter((spec) => spec.group === group);
  const zoneCount = () => props.srZones?.length ?? 0;

  // Close on outside click / Escape. The popover is inline (not portaled) so
  // the chart's own stacking context and the fullscreen modal both contain it.
  createEffect(() => {
    if (!open()) return;
    const onPointerDown = (event: MouseEvent) => {
      const root = rootEl;
      if (root && !root.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    });
  });

  return (
    <div
      ref={(el) => {
        rootEl = el;
      }}
      className="relative inline-flex shrink-0"
      data-testid="chart-indicators-menu"
    >
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open()}
        aria-label={`Indicators (${activeCount()} active)`}
        data-testid="patterns-chart-indicators-trigger"
        data-active-count={activeCount()}
        class="inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-fin border border-fin-border bg-fin-surface px-1.5 text-ui-micro font-semibold text-fin-text transition-colors hover:bg-fin-surface-alt focus-visible:outline focus-visible:outline-1 focus-visible:outline-fin-primary"
        style={{ height: "28px" }}
        onClick={() => setOpen((prev) => !prev)}
      >
        <IconActivity size={14} />
        <Show when={!props.compact}>
          <span>Indicators</span>
        </Show>
        {/* Compact keeps the numeric state visible; only the word is hidden. */}
        <span
          className="inline-flex min-w-[16px] items-center justify-center rounded-full bg-fin-surface-alt px-1 font-mono tabular-nums text-fin-text-muted"
          data-testid="patterns-chart-indicators-count"
        >
          {activeCount()}
        </span>
      </button>

      <Show when={open()}>
        <div
          role="dialog"
          aria-label="Chart indicators"
          data-testid="patterns-chart-indicators-popover"
          class="absolute right-0 top-full z-[80] mt-1 overflow-y-auto rounded-fin border border-fin-border bg-fin-surface shadow-lg"
          style={{ width: "260px", "max-height": "min(60vh, 420px)" }}
        >
          <div className="flex flex-col gap-2 p-2">
            <For each={CHART_INDICATOR_GROUPS}>
              {(group) => (
                <div
                  className="flex flex-col gap-1"
                  data-testid={`chart-indicators-section-${group.toLowerCase()}`}
                >
                  <GroupHeading group={group} />
                  <For each={groupSpecs(group)}>
                    {(spec) => {
                      const availability = () => availabilityFor(spec);
                      return (
                        <Checkbox
                          size="xs"
                          checked={prefs()[spec.id]}
                          disabled={!availability().enabled}
                          onChange={(checked) => setChartIndicator(spec.id, checked)}
                          aria-label={spec.label}
                          data-testid={`chart-indicator-${spec.id}`}
                          className="flex w-full items-center gap-2"
                          label={
                            <span className="flex min-w-0 flex-1 items-center gap-2">
                              <span aria-hidden="true" style={sampleStyle(spec)} />
                              <span className="flex min-w-0 flex-1 flex-col">
                                <span className="flex items-center justify-between gap-2">
                                  <span>{spec.label}</span>
                                  <Show when={spec.id === "srZones" && zoneCount() > 0}>
                                    <span
                                      className="font-mono text-ui-micro tabular-nums text-fin-text-muted"
                                      data-testid="chart-indicator-zones-count"
                                    >
                                      {zoneCount()} zone{zoneCount() === 1 ? "" : "s"}
                                    </span>
                                  </Show>
                                </span>
                                <Show when={availability().reason}>
                                  {(reason) => (
                                    <span
                                      className="text-ui-micro text-fin-text-muted"
                                      data-testid={`chart-indicator-${spec.id}-reason`}
                                    >
                                      {reason()}
                                    </span>
                                  )}
                                </Show>
                                <Show when={spec.description}>
                                  <span className="text-ui-micro text-fin-text-muted">
                                    {spec.description}
                                  </span>
                                </Show>
                              </span>
                            </span>
                          }
                        />
                      );
                    }}
                  </For>
                </div>
              )}
            </For>

            <Show when={resetDirty()}>
              <div className="border-t border-fin-border pt-1">
                <Button
                  size="xs"
                  variant="subtle"
                  fullWidth
                  onClick={resetChartIndicatorPrefs}
                  data-testid="chart-indicators-reset"
                >
                  Reset to defaults
                </Button>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
