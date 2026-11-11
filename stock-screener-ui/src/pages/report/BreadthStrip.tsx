import { formatNumberIN } from "@/utils/ui-helpers";
import { memo } from "react";
import * as palette from "@/ui/palette";
import type { BreadthPayload } from "@/api/reportNifty";

/**
 * Five-index breadth in 20px: NIFTY / BANK / MID / SMALL / BROAD with their
 * day %, plus "n/5 up". A narrow rally (index up, smallcaps red) is the fade
 * warning; a broad one (4-5 up) is a real risk-on tape.
 */
function BreadthStripInner({ data }: { data: BreadthPayload | null }) {
  if (!data?.available || data.rows.length === 0) return null;
  const priced = data.rows.filter((r) => r.change_pct != null);
  const countTone = data.up >= 3 ? palette.POSITIVE : data.up === 0 ? palette.NEGATIVE : palette.WARNING;

  return (
    <div
      data-testid="nifty-breadth-strip"
      data-up={data.up}
      className="flex items-center gap-2.5 min-w-0 shrink-0 overflow-hidden whitespace-nowrap border border-fin-border rounded-sm bg-fin-surface font-mono text-[9px] text-fin-text-muted h-[20px] min-h-[20px] w-full px-2"
    >
      <span className="font-extrabold shrink-0 tracking-[0.08em] text-[9px]" style={{ color: palette.TEXT_MUTED }}>
        BREADTH
      </span>
      <span data-testid="nifty-breadth-count" className="font-extrabold shrink-0" style={{ color: countTone }}>
        {data.up}/{priced.length} up
      </span>
      {priced.map((r) => {
        const pct = r.change_pct ?? 0;
        const tone = pct > 0 ? palette.POSITIVE : pct < 0 ? palette.NEGATIVE : palette.TEXT_MUTED;
        return (
          <span
            key={r.label}
            data-testid={`nifty-breadth-${r.label.toLowerCase()}`}
            title={`${r.label}: ${r.last ? formatNumberIN(r.last) ?? "—" : "—"} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`}
            className="inline-flex items-center gap-1 shrink-0 text-[9px]"
            style={{ color: palette.TEXT_MUTED }}
          >
            {r.label}
            <b style={{ color: tone, fontWeight: 800 }}>
              {pct >= 0 ? "+" : ""}
              {pct.toFixed(2)}%
            </b>
          </span>
        );
      })}
    </div>
  );
}

/** Memoised: the parent repaints on the ~1 s spot tick, `data` only on its 60s poll. */
export const BreadthStrip = memo(BreadthStripInner);
BreadthStrip.displayName = "BreadthStrip";
