import type { JSX } from "solid-js";

export interface PocScrollShellProps {
  children: JSX.Element;
  testId?: string;
  ariaLabel?: string;
}

/**
 * Full-height frame for the POC routes: the page root never scrolls, the inner
 * region owns vertical scrolling. Routes whose body is a single full-height
 * panel (SMC chart) can skip this and size the panel directly.
 */
export function PocScrollShell(props: PocScrollShellProps) {
  return (
    <div data-testid={props.testId} class="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div
        data-testid={props.testId ? `${props.testId}-scroll` : undefined}
        data-scroll="vertical"
        role="region"
        aria-label={props.ariaLabel ?? "Page content, scroll for more"}
        tabIndex={0}
        class="min-h-0 min-w-0 flex-1 overflow-y-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-fin-primary"
      >
        {props.children}
      </div>
    </div>
  );
}
