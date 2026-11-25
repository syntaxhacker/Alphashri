import { Show, type JSX } from "solid-js";
import * as palette from "@/ui/palette";
import { REPORT_FONT } from "./reportTokens";
import {
  GEX_DASH,
  formatGexCr,
  formatGexStrike,
  gexLevelTone,
  gexSideCopy,
  gexTone,
} from "./NiftyGexProfile.format";
import type { GexProfileStats, GexSideLevel } from "./NiftyGexProfile.levels";

/**
 * Stat value for one γ level: the strike plus the net gamma it carries, e.g.
 * `22,600 (+142.30 Cr/pt)`. The magnitude is what separates a real wall from
 * a +0.07 Cr wing that only looked like one.
 */
function GexLevelValue(props: { level: GexSideLevel | null }) {
  const level = () => props.level;
  return (
    <Show when={level()} fallback={<>{GEX_DASH}</>}>
      <>
        {formatGexStrike(level()!.strike)}
        <span
          class="ml-[4px] whitespace-nowrap"
          style={{
            "font-size": `${REPORT_FONT.micro}px`,
            "font-weight": 400,
            "color": palette.TEXT_MUTED,
          }}
        >
          ({formatGexCr(level()!.netGex)})
        </span>
      </>
    </Show>
  );
}

/**
 * The shared compact-stat primitive hardcodes its label span, so at the 472px
 * desk width a four-across row clips "γ resistance" and the gamma figure. This
 * cell keeps the same chrome but gives the label an ellipsis + title tooltip
 * and lets the value wrap, so nothing is lost when the grid narrows.
 */
function GexStat(props: {
  testId: string;
  label: string;
  tone?: string;
  value: JSX.Element | string;
  hint?: JSX.Element | string;
}) {
  return (
    <div
      data-testid={props.testId}
      class="flex flex-col items-center justify-center text-center gap-1 bg-fin-surface border border-fin-border rounded-[4px] px-2 py-2 min-w-0"
    >
      <span
        class="w-full text-ui-micro tracking-[0.06em] leading-tight text-fin-text-muted truncate"
        title={props.label}
      >
        {props.label}
      </span>
      <span
        class="w-full min-w-0 text-ui-body font-bold leading-tight tabular-nums break-words"
        style={{ color: props.tone ?? "var(--color-fin-text)" }}
      >
        {props.value}
      </span>
      <Show when={props.hint}>
        <span
          class="w-full text-ui-micro leading-tight text-fin-text-muted truncate"
          title={typeof props.hint === "string" ? props.hint : undefined}
        >
          {props.hint}
        </span>
      </Show>
    </div>
  );
}

/**
 * The four-cell stat row. The grid is container-driven: `auto-fit` with a
 * 150px floor gives 2–3 readable columns in the 472px desk window and four on
 * a wide monitor, instead of four ~110px cards whose labels and values clipped.
 * All stats, labels, values and unit hints are unchanged — only the chrome and
 * the column template changed.
 */
export function GexStatRow(props: {
  stats: GexProfileStats;
  below: GexSideLevel | null;
  above: GexSideLevel | null;
}) {
  const belowCopy = () => gexSideCopy(props.below, "below");
  const aboveCopy = () => gexSideCopy(props.above, "above");
  return (
    <div
      data-testid="nifty-gex-profile-stat-row"
      class="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-[4px] w-full min-w-0"
    >
      <GexStat
        testId="nifty-gex-profile-net"
        label="Net γ (book)"
        tone={gexTone(props.stats.netTotal) ?? undefined}
        value={formatGexCr(props.stats.netTotal)}
        hint="Σ all strikes"
      />
      <GexStat
        testId="nifty-gex-profile-zero"
        label="Flip level"
        value={formatGexStrike(props.stats.zeroCross)}
        hint="zero γ"
      />
      <GexStat
        testId="nifty-gex-profile-support"
        label={belowCopy().label}
        tone={gexLevelTone(props.below)}
        value={GexLevelValue({ level: props.below })}
        hint={belowCopy().hint}
      />
      <GexStat
        testId="nifty-gex-profile-resist"
        label={aboveCopy().label}
        tone={gexLevelTone(props.above)}
        value={GexLevelValue({ level: props.above })}
        hint={aboveCopy().hint}
      />
    </div>
  );
}
