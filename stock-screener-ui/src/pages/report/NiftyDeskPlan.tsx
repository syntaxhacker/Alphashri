import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { Text } from "@/ui";
import { alpha } from "@/ui/alpha";
import { IconChevronDown, IconChevronRight } from "@/components/common/Icons";
import * as palette from "@/ui/palette";
import type { NiftyReport } from "@/types/niftyReport";
import {
  buildDeskPlan,
  fmtDeskNum,
  fmtDeskRr,
  type DeskBias,
  type DeskReasonTag,
  type DeskSide,
} from "./deskPlan";

/**
 * Two-sided desk plan: what to DO and what NOT to do on each side of the book.
 *
 * Both columns are always rendered because the desk argues both cases: the
 * active bias gets the coloured badge, the other side reads NEUTRAL. The
 * numbers come from `buildDeskPlan`, which is pure and data-only — this file
 * is presentation, not reasoning.
 *
 * The panel is collapsible (open by default, no persistence) and its body is
 * height-capped so the chart below stays on screen at 1080p.
 */

const TAG_COLORS: Record<DeskReasonTag, string> = {
  trend: palette.PRIMARY,
  gamma: palette.TERM_GAMMA,
  oi: palette.TERM_CE,
  vol: palette.WARNING,
  structure: palette.TERM_PE,
};

const NO_TRADE = "NO TRADE — wait";

function biasAccent(bias: DeskBias): string {
  if (bias === "bullish") return palette.POSITIVE;
  if (bias === "bearish") return palette.NEGATIVE;
  return palette.WARNING;
}

function SectionLabel(props: { children: JSX.Element; color: string; testId?: string }) {
  return (
    <Text
      data-testid={props.testId}
      size="xs"
      fw={800}
      span
      style={{
        "color": props.color,
        "font-size": 9,
        "line-height": 1.2,
        "letter-spacing": "0.1em",
        "text-transform": "uppercase",
      }}
    >
      {props.children}
    </Text>
  );
}

function BiasBadge(props: { bias: DeskBias; side: "bull" | "bear" }) {
  const accent = biasAccent(props.bias);
  return (
    <div
      data-testid={`desk-bias-${props.side}`}
      className="inline-flex items-center shrink-0"
      style={{
        "padding-left": "6px",
        "padding-right": "6px",
        "padding-top": "1px",
        "padding-bottom": "1px",
        "border-radius": "9999px",
        border: `1px solid ${alpha(accent, 0.5)}`,
        "background-color": alpha(accent, 0.12),
      }}
    >
      <Text
        span
        size="xs"
        fw={800}
        style={{ color: accent, "font-size": "9px", "line-height": 1.2, "letter-spacing": "0.08em" }}
      >
        {props.bias.toUpperCase()}
      </Text>
    </div>
  );
}

/**
 * Inline Stop / Target / R:R stats. No nested cards — one divider separates
 * each pair so the DO block stays two lines shorter than the old card grid.
 */
function InlineStats(props: { side: DeskSide; noTrade: boolean }) {
  const side = () => props.side;
  const stats: Array<{ label: string; value: string; testId: string }> = [
    {
      label: "Stop",
      value: props.noTrade ? "—" : fmtDeskNum(side().stop),
      testId: `desk-do-${side().side}-stop`,
    },
    {
      label: "Target",
      value: props.noTrade ? "—" : fmtDeskNum(side().target),
      testId: `desk-do-${side().side}-target`,
    },
    {
      label: "R:R",
      value: props.noTrade ? "—" : fmtDeskRr(side().rr),
      testId: `desk-do-${side().side}-rr`,
    },
  ];

  return (
    <div
      data-testid={`desk-do-${side().side}-stats`}
      className="flex items-baseline flex-wrap min-w-0"
      style={{ "column-gap": "8px", "row-gap": "2px" }}
    >
      <For each={stats}>
        {(stat, index) => (
        <div
          class="flex items-baseline min-w-0"
          style={{
            "gap": "4px",
            ...(index() > 0 && {
              "padding-left": "8px",
              "border-left": `1px solid ${palette.TERM_BORDER}`,
            }),
          }}
        >
          <Text
            size="xs"
            fw={700}
            c="dimmed"
            span
            style={{ "font-size": 9, "line-height": 1.2, "letter-spacing": "0.06em", "text-transform": "uppercase" }}
          >
            {stat.label}
          </Text>
          <Text
            data-testid={stat.testId}
            size="xs"
            fw={800}
            span
            style={{ "font-size": 12, "line-height": 1.3, "font-variant-numeric": "tabular-nums" }}
          >
            {stat.value}
          </Text>
        </div>
        )}
      </For>
    </div>
  );
}

function DeskSideColumn(props: { side: DeskSide; label: string; noTrade: boolean }) {
  const side = () => props.side;
  const noTrade = () => props.noTrade;
  const label = () => props.label;
  const accent = () => (side().side === "bull" ? palette.POSITIVE : palette.NEGATIVE);
  const trigger = () =>
    side().alternate
      ? `${side().entryTrigger}, or ${side().alternate!.trigger}`
      : side().entryTrigger;

  return (
    <div
      data-testid={`desk-side-${side().side}`}
      className="flex flex-col min-w-0"
      style={{ gap: "8px" }}
    >
      <div
        className="flex items-center min-w-0"
        style={{
          gap: "8px",
          "padding-bottom": "4px",
          "border-bottom": `1px solid ${palette.TERM_BORDER}`,
        }}
      >
        <Text
          span
          size="xs"
          fw={800}
          style={{ color: accent, "font-size": 11, "line-height": 1.2, "letter-spacing": "0.08em" }}
        >
          {label}
        </Text>
        <BiasBadge bias={side().bias} side={side().side} />
      </div>

      <div
        data-testid={`desk-do-${side().side}`}
        className="flex flex-col min-w-0"
        style={{ gap: "4px" }}
      >
        <SectionLabel color={accent} testId={`desk-do-label-${side().side}`}>
          Do
        </SectionLabel>
        <Text
          data-testid={`desk-do-${side().side}-action`}
          size="xs"
          fw={700}
          lh={1.3}
          style={{ "font-size": 11 }}
        >
          {side().action}
        </Text>
        <Text
          data-testid={`desk-do-${side().side}-trigger`}
          size="xs"
          c="dimmed"
          lh={1.35}
          style={{ "font-size": 10 }}
        >
          {noTrade() ? NO_TRADE : trigger()}
        </Text>
        <InlineStats side={side()} noTrade={noTrade()} />
      </div>

      <div
        data-testid={`desk-dont-${side().side}`}
        className="flex flex-col min-w-0"
        style={{ gap: "4px" }}
      >
        <SectionLabel color={palette.WARNING} testId={`desk-dont-label-${side().side}`}>
          Don't
        </SectionLabel>
        <For each={side().doNots}>
          {(line, index) => (
          <div
            data-testid={`desk-dont-${side().side}-${index()}`}
            class="flex items-start min-w-0"
            style={{ gap: "6px" }}
          >
            <Text span size="xs" fw={800} style={{ color: palette.WARNING, "font-size": 10, "line-height": 1.35 }}>
              ×
            </Text>
            <Text size="xs" c="dimmed" lh={1.35} style={{ "font-size": 10 }}>
              {line}
            </Text>
          </div>
          )}
        </For>
      </div>

      <Show when={side().reasons.length > 0}>
        <div class="flex flex-col min-w-0" style={{ gap: "4px" }}>
          <SectionLabel color={palette.TEXT_MUTED} testId={`desk-reasons-label-${side().side}`}>
            Reasons
          </SectionLabel>
          <ol
            data-testid={`desk-reasons-${side().side}`}
            className="flex flex-col min-w-0"
            style={{ listStyle: "none", margin: 0, padding: 0, gap: "4px" }}
          >
            <For each={side().reasons}>
              {(reason, index) => (
              <li
                data-testid={`desk-reason-${side().side}-${index()}`}
                class="flex items-start min-w-0"
                style={{ gap: "6px" }}
              >
                <Text
                  span
                  size="xs"
                  fw={700}
                  c="dimmed"
                  style={{ "font-size": 10, "line-height": 1.4, "min-width": 12, "font-variant-numeric": "tabular-nums" }}
                >
                  {index() + 1}.
                </Text>
                <div
                  data-testid={`desk-reason-tag-${side().side}-${index()}`}
                  className="inline-flex items-center shrink-0"
                  style={{
                    "padding-left": "4px",
                    "padding-right": "4px",
                    "border-radius": "4px",
                    "background-color": alpha(TAG_COLORS[reason.tag], 0.14),
                    "margin-top": "1px",
                  }}
                >
                  <Text
                    span
                    size="xs"
                    fw={800}
                    style={{
                      color: TAG_COLORS[reason.tag],
                      "font-size": 8,
                      "line-height": 1.5,
                      "letter-spacing": "0.06em",
                      "text-transform": "uppercase",
                    }}
                  >
                    {reason.tag}
                  </Text>
                </div>
                <Text size="xs" c="dimmed" lh={1.4} style={{ "font-size": 10 }}>
                  {reason.text}
                </Text>
              </li>
              )}
            </For>
          </ol>
        </div>
      </Show>
    </div>
  );
}

interface NiftyDeskPlanProps {
  report: NiftyReport;
}

const BODY_ID = "nifty-desk-plan-body";

export function NiftyDeskPlan(props: NiftyDeskPlanProps) {
  const plan = createMemo(() => buildDeskPlan(props.report));
  const [open, setOpen] = createSignal(true);
  const noTrade = () => plan().bias === "neutral";

  return (
    <div
      data-testid="nifty-desk-plan"
      class="shrink-0 min-w-0 flex flex-col border border-fin-border rounded-[4px] overflow-hidden bg-fin-surface"
      style={noTrade() ? { opacity: "0.72" } : {}}
    >
      <div class="flex items-center justify-between gap-2 px-2 py-1 border-b border-fin-border">
        <div class="flex flex-col min-w-0">
          <span class="text-[10px] font-bold uppercase tracking-[0.07em] text-fin-text-secondary">
            Desk plan
          </span>
          <span class="text-[9px] text-fin-text-muted">Both sides · ordered by weight</span>
        </div>
        <button
          type="button"
          data-testid="desk-plan-toggle"
          aria-expanded={open()}
          aria-controls={BODY_ID}
          aria-label={open() ? "Collapse desk plan" : "Expand desk plan"}
          onClick={() => setOpen((value) => !value)}
          class="inline-flex items-center justify-center rounded-sm p-0.5 hover:bg-fin-surface-alt transition-colors duration-150"
          style={{ color: palette.TEXT_MUTED }}
        >
          {open() ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        </button>
      </div>
      <Show when={open()}>
        <div
          id={BODY_ID}
          data-testid="desk-plan-body"
          class="min-w-0"
          style={{
            "padding": "8px",
            "min-width": 0,
            // Keep the chart inside the first 1080p screen; the body scrolls
            // internally when both reason lists run long.
            "max-height": "320px",
            "overflow-y": "auto",
            "scrollbar-gutter": "stable",
          }}
        >
          <Show when={noTrade()}>
            <div
              data-testid="desk-wait-note"
              class="flex items-center min-w-0"
              style={{
                "gap": "6px",
                "padding-bottom": "4px",
                "margin-bottom": "4px",
                "border-bottom": `1px solid ${palette.TERM_BORDER}`,
              }}
            >
              <Text size="xs" fw={700} c="dimmed" lh={1.3} style={{ "font-size": "10px" }}>
                {plan().waitNote}
              </Text>
            </div>
          </Show>
          <div class="grid grid-cols-1 min-[900px]:grid-cols-2 gap-2 min-w-0">
            <DeskSideColumn side={plan().bull} label="BULL" noTrade={noTrade()} />
            <DeskSideColumn side={plan().bear} label="BEAR" noTrade={noTrade()} />
          </div>
        </div>
      </Show>
    </div>
  );
}
