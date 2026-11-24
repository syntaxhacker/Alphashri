import { Show } from "solid-js";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { spotVsFlip } from "./NiftyGammaTime";
import { REPORT_FONT } from "./reportTokens";
import type { GexProfilePoint } from "./niftyGex";
import { GEX_DASH, formatGexStrike, gexTone } from "./NiftyGexProfile.format";
import { GEX_SIGNIFICANCE_SHARE } from "./NiftyGexProfile.geometry";
import type { GexProfileStats, GexSideLevel } from "./NiftyGexProfile.levels";

/** What the profile means for the next move — the panel's reading header. */
export function GexRegimeRow(props: { stats: GexProfileStats; spot: number }) {
  const regimeText = () => (props.stats.regime ? `${props.stats.regime} GAMMA` : GEX_DASH);
  const regimeTone = () =>
    gexTone(props.stats.regime === "LONG" ? 1 : props.stats.regime === "SHORT" ? -1 : null);
  const flipDistance = () => spotVsFlip(props.spot, props.stats.zeroCross);
  const regimeSentence = () =>
    props.stats.regime === "LONG"
      ? "Dealers hold long gamma — the big peak is a magnet: dips there get bought, rallies get sold into."
      : props.stats.regime === "SHORT"
        ? "Dealers are short gamma — the deep trough is fuel: a move through it accelerates instead of stalling."
        : "";
  // The regime chip keeps `nifty-gex-profile-regime` for callers/tests.
  return (
    <div
      data-testid="nifty-gex-profile-regime"
      class="flex items-center gap-[6px] flex-wrap min-w-0"
    >
      <Text
        size="xs"
        span
        fw={700}
        title="Regime = cumulative γ up to spot (the side of the flip spot trades on)"
        className="whitespace-nowrap"
        style={{
          "color": regimeTone(),
          "border": `1px solid ${regimeTone()}`,
          "border-radius": "6px",
          "padding": "4px 2px",
        }}
      >
        {regimeText()}
      </Text>
      <Show when={regimeSentence()}>
        <Text
          size="xs"
          span
          title={regimeSentence()}
          className="min-w-0 flex-1 overflow-hidden truncate whitespace-nowrap"
          style={{
            "color": palette.TEXT_MUTED,
          }}
        >
          {regimeSentence()}
        </Text>
      </Show>
      <Show when={flipDistance()}>
        <Text size="xs" span c="dimmed" className="whitespace-nowrap">
          Spot {formatGexStrike(Number.isFinite(props.spot) ? props.spot : null)} · {flipDistance()}
        </Text>
      </Show>
    </div>
  );
}

/**
 * Upstox quotes greeks for the near-money strikes only, so the far wings are
 * dead zero points. Stating the coverage up front is what makes the plot
 * readable — otherwise it looks like the profile is "missing".
 */
export function GexCoverage(props: {
  band: GexProfilePoint[];
  significant: number;
  total: number;
}) {
  return (
    <Show when={props.band.length > 0 && props.total > 0}>
      <Text data-testid="nifty-gex-profile-coverage" size="xs" span c="dimmed">
        {`band ${formatGexStrike(props.band[0].strike)}–${formatGexStrike(
          props.band[props.band.length - 1].strike,
        )} · ${props.significant} of ${props.total} strikes carry ≥${
          GEX_SIGNIFICANCE_SHARE * 100
        }% of peak γ`}
      </Text>
    </Show>
  );
}

/**
 * Report-wide level key: the horizontal zero line splits dampening (above)
 * from amplifying (below); SUP/RES name the two pin magnets. Dots carry the
 * level colour, labels stay on the panel surface.
 */
export function GexLevelsLegend(props: {
  below: GexSideLevel | null;
  above: GexSideLevel | null;
}) {
  return (
    <div
      data-testid="nifty-gex-profile-levels-legend"
      class="flex flex-wrap items-center gap-[8px] w-full min-w-0"
      style={{ "font-size": `${REPORT_FONT.micro}px`, "line-height": "1.2", color: palette.TEXT_MUTED }}
    >
      <span
        data-testid="nifty-gex-profile-level-legend-sup"
        title="SUP · support — positive-gamma pin magnet below spot (green). A negative-gamma strike below spot is fuel, never support."
        class="inline-flex items-center gap-[4px] whitespace-nowrap"
      >
        <span
          aria-hidden="true"
          class="inline-block shrink-0 rounded-full w-[6px] h-[6px]"
          style={{ "background-color": palette.LEVEL_SUPPORT }}
        />
        <span>SUP {formatGexStrike(props.below?.kind === "support" ? props.below!.strike : null)}</span>
      </span>
      <span
        data-testid="nifty-gex-profile-level-legend-res"
        title="RES · resistance — positive-gamma pin magnet above spot (red). A negative-gamma strike above spot is fuel, never resistance."
        class="inline-flex items-center gap-[4px] whitespace-nowrap"
      >
        <span
          aria-hidden="true"
          class="inline-block shrink-0 rounded-full w-[6px] h-[6px]"
          style={{ "background-color": palette.LEVEL_RESISTANCE }}
        />
        <span>RES {formatGexStrike(props.above?.kind === "resistance" ? props.above!.strike : null)}</span>
      </span>
    </div>
  );
}

export function GexCaption(props: { show: boolean }) {
  return (
    <Show when={props.show}>
      <Text
        data-testid="nifty-gex-profile-caption"
        size="xs"
        span
        c="dimmed"
        title="x: strike · y: net dealer gamma in ₹ Cr/pt on a sqrt scale (so the big walls don't flatten every other strike). Above the 0 line dealers dampen moves at that strike (magnet); below it they amplify them (fuel). SPOT / ZERO mark today's spot and the gamma flip. Support/resistance are positive-gamma pin magnets below/above spot; a negative-gamma strike is fuel on its own side, never support or resistance."
        className="whitespace-nowrap overflow-hidden truncate"
      >
        x: strike · y: net γ (₹ Cr/pt, √ scale) · above 0 = dampening, below 0 = amplifying
      </Text>
    </Show>
  );
}
