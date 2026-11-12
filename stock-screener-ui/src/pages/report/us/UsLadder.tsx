import { createMemo, For, Show } from "solid-js";

import { Text } from "@/ui";
import { NEGATIVE, POSITIVE, SCALE_DARK, WARNING } from "@/ui/palette";
import type { UsRow } from "../../../types/usReport";
import { buildLadder, fmtInt } from "./usReportMath";

const ROW_H = 18;

/** Dense terminal ladder: put OI left, call OI right, walls + spot marked. */
export function UsLadder(props: { row: UsRow }) {
  const built = createMemo(() => buildLadder(props.row));
  const rows = () => built().rows;
  const maxOi = () => built().maxOi;

  return (
    <div
      data-testid="us-ladder"
      class="flex flex-col min-h-0 flex-1 border border-fin-border font-mono tabular-nums text-[10.5px] overflow-hidden"
      style={{ "line-height": `${ROW_H}px` }}
    >
      <div
        class="flex items-center px-1 text-fin-text-muted border-b border-fin-border text-[9.5px] tracking-[0.4px] shrink-0"
      >
        <div class="w-[52px] text-right" style={{ color: NEGATIVE }}>PUT OI</div>
        <div class="flex-1" />
        <div class="w-[62px] text-center">STRIKE</div>
        <div class="flex-1" />
        <div class="w-[52px] text-left" style={{ color: POSITIVE }}>CALL OI</div>
      </div>

      <div class="flex-1 min-h-0 overflow-auto">
        <For each={rows()}>
          {(r) => (
            <Show
              when={r.isMarker}
              fallback={
                <div
                  data-testid={`us-ladder-row-${r.k}`}
                  class="flex items-center px-1 hover:bg-white/[0.04]"
                  style={{
                    "height": `${ROW_H}px`,
                    "border-left": r.isPutWall ? `2px solid ${NEGATIVE}` : "2px solid transparent",
                    "border-right": r.isCallWall ? `2px solid ${POSITIVE}` : "2px solid transparent",
                    "background-color": r.isSpot
                      ? "rgba(88,166,255,0.16)"
                      : r.isMaxPain
                        ? "rgba(240,136,62,0.10)"
                        : "transparent",
                  }}
                >
                  <div class="w-[50px] text-right" style={{ color: r.p_oi ? NEGATIVE : SCALE_DARK[3] }}>
                    {fmtInt(r.p_oi)}
                  </div>
                  <div class="flex-1 flex justify-end pr-1">
                    <div class="h-[7px] opacity-75 bg-fin-negative" style={{ "width": `${(r.p_oi / maxOi()) * 100}%`, "max-width": "100%" }} />
                  </div>
                  <div
                    class={`w-[66px] text-center ${r.isPutWall || r.isCallWall ? "font-extrabold" : "font-medium"}`}
                    style={{ color: r.isMaxPain ? WARNING : undefined }}
                  >
                    {fmtInt(r.k)}
                  </div>
                  <div class="flex-1 flex pl-1">
                    <div class="h-[7px] opacity-75 bg-fin-positive" style={{ "width": `${(r.c_oi / maxOi()) * 100}%`, "max-width": "100%" }} />
                  </div>
                  <div class="w-[50px] text-left" style={{ color: r.c_oi ? POSITIVE : SCALE_DARK[3] }}>
                    {fmtInt(r.c_oi)}
                  </div>
                </div>
              }
            >
              <div
                class="flex items-center px-1 font-bold bg-[rgba(88,166,255,0.16)] text-fin-info"
                style={{ height: `${ROW_H}px` }}
              >
                <div class="w-[52px]" />
                <div class="flex-1 opacity-70 border-t border-dashed border-fin-info" />
                <div class="w-[62px] text-center">{fmtInt(props.row.spot)}</div>
                <div class="flex-1 opacity-70 border-t border-dashed border-fin-info" />
                <div class="w-[52px]" />
              </div>
            </Show>
          )}
        </For>
      </div>

      <div
        class="shrink-0 px-1 py-0.5 border-t border-fin-border text-fin-text-muted text-[9px] flex gap-[10px] flex-wrap"
      >
        <Text size="xs" c="dimmed" span>
          wall {fmtInt(props.row.put_wall)}P / {fmtInt(props.row.call_wall)}C
        </Text>
        <Text size="xs" c="dimmed" span>
          pain {fmtInt(props.row.max_pain)}
        </Text>
        <Text size="xs" c="dimmed" span>
          GEX {props.row.net_gex ? `${props.row.net_gex >= 0 ? "+" : ""}${props.row.net_gex.toFixed(0)}m` : "–"}
        </Text>
      </div>
    </div>
  );
}
