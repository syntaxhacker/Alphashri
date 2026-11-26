import { Show, type JSX } from "solid-js";
import { Box } from "@/ui";
import { cn } from "@/ui/cn";
import { ScrollSidewaysCue } from "./ScrollSidewaysCue";

// The table owns its own scrollport (`.paper-tanstack-scroll`). Descendant
// selectors from this wrapper reach the first header/body cell through it, so
// the identifier column stays put while the numeric block scrolls. The `!`
// suffix is required: the table sets an inline `background-color: inherit`.
const STICKY_FIRST_COLUMN = [
  "[&_th:first-of-type]:sticky",
  "[&_th:first-of-type]:left-0",
  "[&_th:first-of-type]:z-[3]",
  "[&_th:first-of-type]:[background:var(--color-fin-surface-alt)]!",
  "[&_th:first-of-type]:[box-shadow:1px_0_0_0_var(--color-fin-border)]!",
  "[&_td:first-of-type]:sticky",
  "[&_td:first-of-type]:left-0",
  "[&_td:first-of-type]:z-[2]",
  "[&_td:first-of-type]:[background:var(--color-fin-surface)]!",
  "[&_td:first-of-type]:[box-shadow:1px_0_0_0_var(--color-fin-border)]!",
].join(" ");

const KEYBOARD_SCROLL_STEP = 80;

export interface PatternScrollRegionProps {
  children: JSX.Element;
  /** Test id on the labelled, focusable scroll container. */
  testId: string;
  cueTestId: string;
  ariaLabel: string;
  stickyFirstColumn?: boolean;
  className?: string;
  cueClassName?: string;
  /** False when the narrow layout has no sideways scroll to afford. */
  showCue?: boolean;
}

/**
 * Explicit horizontal scroll region for dense pattern results. The cue is
 * hidden at desktop widths so it never steals space from the 1600px layout.
 */
export function PatternScrollRegion(props: PatternScrollRegionProps) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const scroller = (event.currentTarget as HTMLElement).querySelector<HTMLElement>(
      ".paper-tanstack-scroll",
    );
    if (!scroller) return;
    scroller.scrollLeft +=
      event.key === "ArrowRight" ? KEYBOARD_SCROLL_STEP : -KEYBOARD_SCROLL_STEP;
    event.preventDefault();
  };

  return (
    <Box className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Attached to the container's top edge: a cue below a full-height table
          ends up stranded far from the columns it describes. */}
      <Show when={props.showCue !== false}>
        <ScrollSidewaysCue testId={props.cueTestId} className={props.cueClassName} />
      </Show>
      <div
        data-testid={props.testId}
        data-scroll="horizontal"
        role="region"
        aria-label={props.ariaLabel}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className={cn(
          "min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-fin-text",
          props.stickyFirstColumn ? STICKY_FIRST_COLUMN : undefined,
          props.className,
        )}
      >
        {props.children}
      </div>
    </Box>
  );
}
