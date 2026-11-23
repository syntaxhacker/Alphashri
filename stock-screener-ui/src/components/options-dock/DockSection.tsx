import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { Box, Text } from "@/ui";

/**
 * One labelled band of the options dock.
 *
 * The dock is a single narrow column, so hierarchy comes from a 40px header and
 * the shared type tiers — not from more hairlines. Sections are separated by
 * one `border-fin-border-subtle` rule inside the same surface; bodies use the
 * 12px panel padding and 12px inner gap so no two text runs touch.
 */
export function DockSection(props: {
  title: string;
  /** Replaces the title/meta row (the analytics strip owns its own labels). */
  header?: JSX.Element;
  /** Right-hand meta: a badge, a count, an amount. Never a second title. */
  meta?: JSX.Element;
  testId?: string;
  headerTestId?: string;
  /** Fill the remaining column height (the chain) instead of hugging content. */
  fill?: boolean;
  /** `false` for edge-to-edge bodies: charts and the chain table. */
  padded?: boolean;
  bodyClass?: string;
  /** `false` when the previous sibling already draws the hairline. */
  separated?: boolean;
  /** Extra classes on the outer section (e.g. a height cap for the chain). */
  className?: string;
  footer?: JSX.Element;
  children: JSX.Element;
}) {
  const padded = () => props.padded ?? true;
  const separated = () => props.separated ?? true;

  return (
    <Box
      data-dock-section=""
      data-testid={props.testId}
      className={`flex min-w-0 flex-col ${
        props.fill ? "min-h-0 flex-1" : "shrink-0"
      }${separated() ? " border-t border-fin-border-subtle" : ""}${
        props.className ? ` ${props.className}` : ""
      }`}
    >
      <Box
        data-testid={props.headerTestId}
        className={`flex h-10 shrink-0 items-center justify-between gap-3 bg-fin-surface-alt/40${
          props.header ? "" : " px-4"
        }`}
      >
        <Show
          when={props.header}
          fallback={
            <>
              <Text
                size="sm"
                fw={600}
                className="truncate font-mono uppercase tracking-[0.06em] text-fin-text"
              >
                {props.title}
              </Text>
              <Show when={props.meta}>
                <Box className="flex shrink-0 items-center gap-2">{props.meta}</Box>
              </Show>
            </>
          }
        >
          {props.header}
        </Show>
      </Box>

      <Box
        className={`flex min-w-0 flex-col gap-3${
          padded() ? " px-3 py-3" : " min-h-0 flex-1"
        }${props.bodyClass ? ` ${props.bodyClass}` : ""}`}
      >
        {props.children}
      </Box>

      <Show when={props.footer}>
        <Box className="shrink-0">{props.footer}</Box>
      </Show>
    </Box>
  );
}
