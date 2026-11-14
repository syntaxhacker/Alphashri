import { For, Show } from "solid-js";
import { formatNumberIN } from "@/utils/ui-helpers";
import * as palette from "@/ui/palette";
import type { BreadthPayload } from "@/api/reportNifty";

/**
 * Five-index breadth as one 24px band: NIFTY / BANK / MID / SMALL / BROAD with
 * their day %, plus "n/5 up". A narrow rally (index up, smallcaps red) is the
 * fade warning; a broad one (4-5 up) is a real risk-on tape.
 *
 * The page panel owns the outer border, so this is a band of cells divided by a
 * single 1px rule. Every cell is `shrink-0` — the strip never wraps.
 */
export function BreadthStrip(props: { data: BreadthPayload | null }) {
  const priced = () =>
    props.data?.available ? props.data.rows.filter((r) => r.change_pct != null) : [];
  return (
    <Show when={props.data?.available && props.data.rows.length > 0 ? props.data : null}>
      {(data) => (
        <div
          data-testid="nifty-breadth-strip"
          data-up={data().up}
          class="flex items-stretch min-w-0 shrink-0 overflow-hidden whitespace-nowrap bg-fin-surface font-mono text-[10px] text-fin-text-muted h-6 min-h-6 w-full"
        >
          <span
            class="inline-flex items-center shrink-0 px-2 font-extrabold tracking-[0.06em] text-[10px] border-l-0"
            style={{ color: palette.TEXT_MUTED }}
          >
            BREADTH
          </span>
          <span
            data-testid="nifty-breadth-count"
            class="inline-flex items-center shrink-0 px-2 font-extrabold tabular-nums border-l border-fin-border"
            style={{ color: data().up >= 3 ? palette.POSITIVE : data().up === 0 ? palette.NEGATIVE : palette.WARNING }}
          >
            {data().up}/{priced().length} up
          </span>
          <For each={priced()}>
            {(r) => {
              const pct = r.change_pct ?? 0;
              const tone = pct > 0 ? palette.POSITIVE : pct < 0 ? palette.NEGATIVE : palette.TEXT_MUTED;
              return (
                <span
                  data-testid={`nifty-breadth-${r.label.toLowerCase()}`}
                  title={`${r.label}: ${r.last ? formatNumberIN(r.last) ?? "—" : "—"} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`}
                  class="inline-flex items-center gap-1 shrink-0 px-2 text-[10px] border-l border-fin-border"
                  style={{ color: palette.TEXT_MUTED }}
                >
                  {r.label}
                  <b style={{ color: tone, "font-weight": 800, "font-variant-numeric": "tabular-nums" }}>
                    {pct >= 0 ? "+" : ""}
                    {pct.toFixed(2)}%
                  </b>
                </span>
              );
            }}
          </For>
        </div>
      )}
    </Show>
  );
}
