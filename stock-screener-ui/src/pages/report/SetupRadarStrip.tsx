import { For, Show } from "solid-js";
import * as palette from "@/ui/palette";
import type { SetupRead, SetupState } from "./niftySetup";
import type { PreMoveScore } from "./niftyPreMove";

const STATE_COLOR: Record<SetupState, string> = {
  QUIET: palette.TEXT_MUTED,
  ARMED: palette.WARNING,
  TRIGGER: palette.POSITIVE,
};

const STATE_LABEL: Record<SetupState, string> = {
  QUIET: "QUIET",
  ARMED: "ARMED",
  TRIGGER: "TRIGGER",
};

/**
 * Five pre-move gates in one 24px line. Green = condition present, dim = not.
 * The score is the number of gates; ARMED (4/5) means prepare, TRIGGER (5/5)
 * means the wall is actually being covered. Every gate carries its own numbers
 * in the tooltip so the chip is a prompt, not a verdict.
 */
export function SetupRadarStrip(props: { read: SetupRead; preMove?: PreMoveScore }) {
  return (
    <div
      data-testid="nifty-setup-radar"
      data-state={props.read.state}
      class="flex items-center gap-1.5 min-w-0 shrink-0 overflow-hidden whitespace-nowrap border border-fin-border rounded-sm bg-fin-surface font-mono text-[9px] text-fin-text-muted h-[24px] min-h-[24px] w-full px-2"
    >
      <span class="font-extrabold shrink-0 tracking-[0.08em] text-[9px]" style={{ color: palette.TEXT_MUTED }}>
        SETUP
      </span>
      <For each={props.read.gates}>{(g) => {
        const pass = g.pass === true;
        const tone = pass ? palette.POSITIVE : palette.TEXT_MUTED;
        const bg = pass ? "rgba(63,185,80,0.10)" : "transparent";
        return (
          <span
            data-testid={`nifty-setup-${g.key.toLowerCase()}`}
            data-pass={pass ? "true" : "false"}
            title={`${g.key}: ${g.detail}`}
            class="font-bold shrink-0 tracking-[0.04em] text-[9px] inline-block rounded-[3px]"
            style={{
              padding: "1px 4px",
              border: `1px solid ${tone}`,
              "background-color": bg,
              color: tone,
            }}
          >
            {g.key} {pass ? "✓" : "–"}
          </span>
        );
      }}</For>
      <Show when={props.preMove && props.preMove.state !== "quiet"}>
        <span
          data-testid="nifty-premove"
          data-state={props.preMove!.state}
          title={props.preMove!.components
            .map((c) => `${c.points > 0 ? "+" : ""}${c.points} ${c.label} — ${c.detail}`)
            .join("\n")}
          class="font-black shrink-0 tracking-[0.04em] text-[9px] inline-block rounded-[3px]"
          style={{
            padding: "1px 4px",
            border: `1px solid ${props.preMove!.state === "armed" ? palette.POSITIVE : palette.WARNING}`,
            "background-color": props.preMove!.state === "armed" ? "rgba(63,185,80,0.10)" : "transparent",
            color: props.preMove!.state === "armed" ? palette.POSITIVE : palette.WARNING,
            "margin-left": "6px",
          }}
        >
          PRE {props.preMove!.score}/{props.preMove!.max} {props.preMove!.state === "armed" ? "ARMED" : "WATCH"}
        </span>
      </Show>
      <span
        data-testid="nifty-setup-score"
        class="font-black shrink-0 text-[10px]"
        style={{ "margin-left": props.preMove && props.preMove.state !== "quiet" ? "6px" : "auto", color: STATE_COLOR[props.read.state] }}
      >
        {props.read.score}/{props.read.gates.length} · {STATE_LABEL[props.read.state]}
      </span>
    </div>
  );
}
