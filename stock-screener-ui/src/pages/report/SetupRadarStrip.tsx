import { For, Show } from "solid-js";
import * as palette from "@/ui/palette";
import { REPORT_PAD } from "./reportTokens";
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
 * Pre-move gates in one compact line. Green = condition present, dim = not.
 * The score is the number of gates; ARMED means prepare, TRIGGER means the wall
 * is actually being covered. Every gate carries its own numbers in the tooltip
 * so the chip is a prompt, not a verdict. At 390 the gates wrap as whole chips.
 */
export function SetupRadarStrip(props: { read: SetupRead; preMove?: PreMoveScore }) {
  return (
    <div
      data-testid="nifty-setup-radar"
      data-state={props.read.state}
      data-report-spacing="8"
      class="flex items-center gap-2 min-w-0 shrink-0 whitespace-nowrap border border-fin-border rounded-sm bg-fin-surface font-mono text-ui-micro text-fin-text-muted h-[24px] min-h-[24px] w-full px-2 max-[600px]:h-auto max-[600px]:min-h-0 max-[600px]:flex-wrap max-[600px]:gap-y-1 max-[600px]:py-1"
    >
      <span data-report-text="label" class="font-extrabold shrink-0 tracking-[0.08em] text-ui-micro" style={{ color: palette.TEXT_MUTED }}>
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
            data-report-spacing="8"
            class="inline-flex items-baseline gap-1 font-bold shrink-0 tracking-[0.04em] text-ui-body inline-block rounded-[3px]"
            style={{
              padding: `${REPORT_PAD.xs}px ${REPORT_PAD.md}px`,
              border: `1px solid ${tone}`,
              "background-color": bg,
              color: tone,
            }}
          >
            <span data-report-text="label" class="text-ui-micro">{g.key}</span>{" "}
            <span data-report-text="value" class="text-ui-body">{pass ? "✓" : "–"}</span>
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
          data-report-spacing="8"
          class="font-black shrink-0 tracking-[0.04em] text-ui-body inline-block rounded-[3px]"
          style={{
            padding: `${REPORT_PAD.xs}px ${REPORT_PAD.md}px`,
            border: `1px solid ${props.preMove!.state === "armed" ? palette.POSITIVE : palette.WARNING}`,
            "background-color": props.preMove!.state === "armed" ? "rgba(63,185,80,0.10)" : "transparent",
            color: props.preMove!.state === "armed" ? palette.POSITIVE : palette.WARNING,
            "margin-left": `${REPORT_PAD.md}px`,
          }}
        >
          <span data-report-text="label" class="text-ui-micro">PRE</span>{" "}
          <span data-report-text="value" class="text-ui-body">{props.preMove!.score}/{props.preMove!.max} {props.preMove!.state === "armed" ? "ARMED" : "WATCH"}</span>
        </span>
      </Show>
      <span
        data-testid="nifty-setup-score"
        data-report-text="value"
        class="font-black shrink-0 text-ui-body"
        style={{
          "margin-left": props.preMove && props.preMove.state !== "quiet" ? `${REPORT_PAD.md}px` : "auto",
          color: STATE_COLOR[props.read.state],
        }}
      >
        {props.read.score}/{props.read.gates.length} · {STATE_LABEL[props.read.state]}
      </span>
    </div>
  );
}
