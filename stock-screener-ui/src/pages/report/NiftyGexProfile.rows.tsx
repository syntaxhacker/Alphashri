import { Show } from "solid-js";
import * as palette from "@/ui/palette";
import { LocalCompactStat } from "./reportBits";
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
 * The four-cell stat row. Plain grid instead of CompactStatGrid (whose
 * wrapper padding costs ~12px). All stats, labels, values and unit hints are
 * unchanged — only the chrome shrinks.
 */
export function GexStatRow(props: {
  stats: GexProfileStats;
  below: GexSideLevel | null;
  above: GexSideLevel | null;
}) {
  const belowCopy = () => gexSideCopy(props.below, "below");
  const aboveCopy = () => gexSideCopy(props.above, "above");
  return (
    <div class="grid grid-cols-[repeat(4,minmax(0,1fr))] gap-[4px] w-full min-w-0">
      <LocalCompactStat
        testId="nifty-gex-profile-net"
        label="Net γ (book)"
        tone={gexTone(props.stats.netTotal) ?? undefined}
        value={formatGexCr(props.stats.netTotal)}
        hint="Σ all strikes"
      />
      <LocalCompactStat
        testId="nifty-gex-profile-zero"
        label="Flip level"
        value={formatGexStrike(props.stats.zeroCross)}
        hint="zero γ"
      />
      <LocalCompactStat
        testId="nifty-gex-profile-support"
        label={belowCopy().label}
        tone={gexLevelTone(props.below)}
        value={GexLevelValue({ level: props.below })}
        hint={belowCopy().hint}
      />
      <LocalCompactStat
        testId="nifty-gex-profile-resist"
        label={aboveCopy().label}
        tone={gexLevelTone(props.above)}
        value={GexLevelValue({ level: props.above })}
        hint={aboveCopy().hint}
      />
    </div>
  );
}
