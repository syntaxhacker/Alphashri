import { Show, type JSX } from "solid-js";
import { Button } from "@/ui";

export function LocalCompactPanel(props: {
  title?: JSX.Element | string;
  testId?: string;
  /** Header-right slot (e.g. an action badge). */
  action?: JSX.Element;
  /** Drop the body's default padding. */
  flush?: boolean;
  style?: JSX.CSSProperties;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <div
      data-testid={props.testId}
      class={`flex flex-col border border-fin-border rounded-[2px] overflow-hidden font-mono${props.class ? ` ${props.class}` : ""}`}
      style={props.style}
    >
      <div class="flex items-center justify-between gap-2 px-2 py-1 border-b border-fin-border bg-fin-surface shrink-0">
        <span class="text-[11px] font-bold uppercase tracking-[0.08em] text-fin-primary">
          {"· "}
          {props.title}
        </span>
        <Show when={props.action}>{props.action}</Show>
      </div>
      {/*
        * The body must own the leftover height. Without `flex-1` a panel that
        * asks its content to fill (the chart, any canvas/table) collapsed to
        * the content's intrinsic height — the NIFTY chart rendered 30px tall
        * inside a 300px panel because `[&_[data-compact-card-content]]:flex-1`
        * targeted an attribute this component never emitted.
        */}
      <div
        data-compact-card-content=""
        class={`flex flex-col flex-1 min-h-0 overflow-auto${props.flush ? "" : " gap-1 p-[6px]"}`}
      >
        {props.children}
      </div>
    </div>
  );
}

export function LocalCompactStat(props: {
  testId?: string;
  label: string;
  tone?: string;
  value: JSX.Element | string;
  hint?: JSX.Element | string;
}) {
  return (
    <div
      data-testid={props.testId}
      class="flex flex-col items-center justify-center text-center gap-0.5 bg-fin-surface border border-fin-border rounded-[4px] px-1 py-1.5 min-w-0"
    >
      <span class="text-[11px] uppercase tracking-[0.06em] leading-[1.1] text-fin-text-muted">
        {props.label}
      </span>
      <span
        class="text-[11px] font-bold leading-none tabular-nums"
        style={{ color: props.tone ?? "var(--color-fin-text)" }}
      >
        {props.value}
      </span>
      <Show when={props.hint}>
        <span class="text-[11px] leading-[1.1] text-fin-text-muted">{props.hint}</span>
      </Show>
    </div>
  );
}

export function LocalEmptyState(props: { testId?: string; title: string; description: string }) {
  return (
    <div data-testid={props.testId} class="flex flex-col items-center justify-center gap-1 py-4 px-2 text-center">
      <span class="text-[11px] font-semibold leading-tight text-fin-text">{props.title}</span>
      <span class="text-[11px] leading-snug text-fin-text-muted">{props.description}</span>
    </div>
  );
}

/**
 * One row standing in for several low-frequency read-only bands. The content
 * stays mounted while collapsed — only its rendered height is removed — so a
 * disclosure never takes a metric out of the page tree.
 */
export function LiveTapeDisclosure(props: {
  open: boolean;
  onToggle: () => void;
  children: JSX.Element;
  testId?: string;
  /** Optional copy overrides so the one disclosure primitive can front more
   *  than the tape band without growing a second collapse widget. */
  label?: string;
  openHint?: string;
  closedHint?: string;
}) {
  const open = () => props.open;
  return (
    <div
      data-testid={props.testId ?? "nifty-live-tape-disclosure"}
      data-open={open() ? "true" : "false"}
      class="flex flex-col gap-1 w-full min-w-0 shrink-0"
    >
      <Button
        data-testid="nifty-live-tape-toggle"
        type="button"
        size="xs"
        variant="default"
        aria-expanded={open()}
        aria-controls="nifty-live-tape-content"
        onClick={() => props.onToggle()}
        className="h-7 min-h-7 w-full justify-start px-2 rounded-[2px] text-[11px] font-extrabold uppercase tracking-[0.08em] text-fin-text-muted"
      >
        <span data-testid="nifty-live-tape-chevron" aria-hidden="true" class="mr-2 text-[11px]">
          {open() ? "▾" : "▸"}
        </span>
        <span>{props.label ?? "LIVE TAPE"}</span>
        <span class="ml-auto font-normal normal-case tracking-normal text-[11px] text-fin-text-muted">
          {open() ? (props.openHint ?? "hide bands") : (props.closedHint ?? "breadth · 10s · erosion")}
        </span>
      </Button>
      <div
        id="nifty-live-tape-content"
        data-testid="nifty-live-tape-content"
        class="flex flex-col gap-1 w-full min-w-0"
        style={{ display: open() ? "flex" : "none" }}
      >
        {props.children}
      </div>
    </div>
  );
}
