import { For, Show } from "solid-js";
import { formatNumberIN } from "@/utils/ui-helpers";
import * as palette from "@/ui/palette";
import type { BreadthPayload } from "@/api/reportNifty";

/**
 * Five-index breadth in 20px: NIFTY / BANK / MID / SMALL / BROAD with their
 * day %, plus "n/5 up". A narrow rally (index up, smallcaps red) is the fade
 * warning; a broad one (4-5 up) is a real risk-on tape.
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
          class="flex items-center gap-2.5 min-w-0 shrink-0 overflow-hidden whitespace-nowrap border border-fin-border rounded-sm bg-fin-surface font-mono text-[9px] text-fin-text-muted h-[20px] min-h-[20px] w-full px-2"
        >
          <span class="font-extrabold shrink-0 tracking-[0.08em] text-[9px]" style={{ color: palette.TEXT_MUTED }}>
            BREADTH
          </span>
          <span
            data-testid="nifty-breadth-count"
            class="font-extrabold shrink-0"
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
                  class="inline-flex items-center gap-1 shrink-0 text-[9px]"
                  style={{ color: palette.TEXT_MUTED }}
                >
                  {r.label}
                  <b style={{ color: tone, fontWeight: 800 }}>
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
