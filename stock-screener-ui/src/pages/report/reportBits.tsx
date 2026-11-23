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
      {/*
       * One shared header for every report panel. `flex-wrap` keeps a long
       * title from squeezing the action at intermediate widths; the 640px
       * rule stacks them at phone widths. There is no fixed header height —
       * wrapping must grow the header, not strand a dead row under it.
       */}
      <div
        data-compact-card-header=""
        class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2 border-b border-fin-border bg-fin-surface shrink-0 max-[640px]:flex-col max-[640px]:items-stretch"
      >
        <span class="min-w-0 break-words text-ui-label font-bold uppercase tracking-[0.08em] text-fin-primary">
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
        class={`flex flex-col flex-1 min-h-0 overflow-auto${props.flush ? "" : " gap-2 p-2"}`}
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
      class="flex flex-col items-center justify-center text-center gap-1 bg-fin-surface border border-fin-border rounded-[4px] px-2 py-2 min-w-0"
    >
      <span class="text-ui-micro uppercase tracking-[0.06em] leading-tight text-fin-text-muted">
        {props.label}
      </span>
      <span
        class="text-ui-body font-bold leading-tight tabular-nums"
        style={{ color: props.tone ?? "var(--color-fin-text)" }}
      >
        {props.value}
      </span>
      <Show when={props.hint}>
        <span class="text-ui-micro leading-tight text-fin-text-muted">{props.hint}</span>
      </Show>
    </div>
  );
}

export function LocalEmptyState(props: { testId?: string; title: string; description: string }) {
  return (
    <div data-testid={props.testId} class="flex flex-col items-center justify-center gap-2 py-4 px-3 text-center">
      <span class="text-ui-label font-semibold leading-tight text-fin-text">{props.title}</span>
      <span class="text-ui-body leading-snug text-fin-text-muted">{props.description}</span>
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
        className="h-7 min-h-7 w-full flex-wrap justify-start gap-x-2 gap-y-1 px-2 rounded-[2px] text-ui-label font-extrabold uppercase tracking-[0.08em] text-fin-text-muted max-[480px]:h-auto"
      >
        <span data-testid="nifty-live-tape-chevron" aria-hidden="true" class="mr-1 text-ui-label">
          {open() ? "▾" : "▸"}
        </span>
        <span class="min-w-0 whitespace-normal">{props.label ?? "LIVE TAPE"}</span>
        <span class="ml-auto min-w-0 whitespace-normal font-normal normal-case tracking-normal text-ui-micro text-fin-text-muted">
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
