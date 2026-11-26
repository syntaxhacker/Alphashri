import { For, Show } from "solid-js";
import type { ChartMarket } from "@/utils/chart/time";
import { SR_ZONE_LEGEND_NAMES } from "./patternIndicatorData";
import { formatChartPrice } from "./chartFormat";
import type { TVRect } from "./patternTVData";

/**
 * `bars_since_touch` is not on the shared type yet; read it defensively so the
 * summary can carry recency as soon as the built zones provide it.
 */
type SummaryZone = TVRect & { bars_since_touch?: number };

export interface SRZoneSummaryProps {
  /** Built/aligned zones — the same set the canvas draws, never raw payload. */
  zones: readonly SummaryZone[];
  market?: ChartMarket;
  /** Opt into a visible "Levels" disclosure; hidden remains the default. */
  visible?: boolean;
  testId?: string;
}

function recency(zone: SummaryZone): string | null {
  const bars = zone.bars_since_touch;
  if (typeof bars !== "number" || !Number.isFinite(bars) || bars < 0) return null;
  return `last touched ${bars} bar${bars === 1 ? "" : "s"} ago`;
}

/** One list row: kind, price band, touches and optional recency. */
export function srZoneSummaryText(zone: SummaryZone, market?: ChartMarket): string {
  const low = Math.min(zone.top, zone.bottom);
  const high = Math.max(zone.top, zone.bottom);
  const touches = zone.touches;
  const parts = [
    `${SR_ZONE_LEGEND_NAMES[zone.kind]}: ${formatChartPrice(low, market)} to ${formatChartPrice(high, market)}`,
    `${touches} ${touches === 1 ? "touch" : "touches"}`,
  ];
  const when = recency(zone);
  if (when) parts.push(when);
  return parts.join(", ");
}

export function SRZoneSummary(props: SRZoneSummaryProps) {
  const id = () => props.testId ?? "sr-zone-summary";
  const rows = () => (
    <ul data-testid={`${id()}-list`}>
      <For each={props.zones}>
        {(zone) => (
          <li data-testid={`${id()}-item`}>{srZoneSummaryText(zone, props.market)}</li>
        )}
      </For>
    </ul>
  );

  return (
    <Show when={props.zones.length > 0}>
      <Show
        when={props.visible === true}
        fallback={
          <section class="sr-only" data-testid={id()}>
            <p>Support and resistance levels</p>
            {rows()}
          </section>
        }
      >
        <details data-testid={id()}>
          <summary>Levels</summary>
          {rows()}
        </details>
      </Show>
    </Show>
  );
}
