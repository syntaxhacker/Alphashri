import { For, Show } from "solid-js";
import { formatNumberIN } from "@/utils/ui-helpers";
import * as palette from "@/ui/palette";
import type { BreadthPayload } from "@/api/reportNifty";

/** The one phrase used for every band replay cannot reconstruct. Living here
 *  (the leaf strip) keeps every consumer off a lazy chunk and avoids a cycle:
 *  walls, movers and the strips all render this same component. */
export const REPLAY_UNAVAILABLE_TEXT = "Not captured in replay";

export function ReplayUnavailable(props: {
  noun: string;
  testId?: string;
  className?: string;
}) {
  return (
    <span
      data-testid={props.testId ?? `replay-unavailable-${props.noun.toLowerCase().replace(/\s+/g, "-")}`}
      data-replay-unavailable="true"
      class={`inline-flex items-center min-w-0 whitespace-nowrap pl-2 text-ui-micro font-semibold tracking-[0.06em] text-fin-text-muted ${props.className ?? ""}`}
      data-report-text="label"
      style={{ "border-left": `1px solid ${palette.alpha(palette.BORDER, 0.6)}` }}
    >
      <span class="uppercase">{props.noun}</span> · {REPLAY_UNAVAILABLE_TEXT}
    </span>
  );
}

/**
 * Five-index breadth as one 24px band: NIFTY / BANK / MID / SMALL / BROAD with
 * their day %, plus "n/5 up". A narrow rally (index up, smallcaps red) is the
 * fade warning; a broad one (4-5 up) is a real risk-on tape.
 *
 * The page panel owns the outer border, so this is a band of cells divided by a
 * single 1px rule. Cells are `shrink-0` with whole values; at 390 the band
 * becomes a short wrapping grid instead of clipping the last index mid-number.
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
          class="flex items-stretch min-w-0 shrink-0 overflow-hidden whitespace-nowrap bg-fin-surface font-mono text-ui-micro text-fin-text-muted h-6 min-h-6 w-full max-[600px]:h-auto max-[600px]:min-h-0 max-[600px]:overflow-visible"
        >
          <div class="flex items-stretch min-w-0 w-full max-[600px]:flex-wrap max-[600px]:gap-y-1">
            <span
              data-report-text="label"
              class="inline-flex items-center shrink-0 px-2 font-extrabold tracking-[0.08em] text-ui-micro border-l-0"
              style={{ color: palette.TEXT_MUTED }}
            >
              BREADTH
            </span>
            <span
              data-testid="nifty-breadth-count"
              data-report-text="value"
              class="inline-flex items-center shrink-0 px-2 text-ui-body font-extrabold tabular-nums whitespace-nowrap"
              style={{
                color: data().up >= 3 ? palette.POSITIVE : data().up === 0 ? palette.NEGATIVE : palette.WARNING,
                "border-left": `1px solid ${palette.alpha(palette.BORDER, 0.6)}`,
              }}
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
                    class="inline-flex items-center gap-2 shrink-0 px-2 text-ui-micro"
                    style={{
                      color: palette.TEXT_MUTED,
                      "border-left": `1px solid ${palette.alpha(palette.BORDER, 0.6)}`,
                    }}
                  >
                    <span data-report-text="label" class="text-ui-micro">{r.label}</span>
                    <b
                      data-report-text="value"
                      class="text-ui-body whitespace-nowrap"
                      style={{ color: tone, "font-weight": 800, "font-variant-numeric": "tabular-nums" }}
                    >
                      {pct >= 0 ? "+" : ""}
                      {pct.toFixed(2)}%
                    </b>
                  </span>
                );
              }}
            </For>
          </div>
        </div>
      )}
    </Show>
  );
}
