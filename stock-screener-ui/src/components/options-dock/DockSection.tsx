import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { Box, Text } from "@/ui";

/**
 * One labelled band of the options dock.
 *
 * The dock is a single narrow column, so hierarchy has to come from the header
 * band and the type weight — not from more hairlines. Each section is separated
 * by exactly one `border-t`, its header is a tinted 22px strip at 10px, and
 * every label inside a body stays at 9px so the header is the only title weight
 * in the column.
 */
export function DockSection(props: {
  title: string;
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
      }${separated() ? " border-t border-fin-border" : ""}`}
    >
      <Box
        data-testid={props.headerTestId}
        className="flex h-[22px] shrink-0 items-center justify-between gap-2 bg-fin-surface-alt/40 px-2"
      >
        <Text
          size="xs"
          fw={700}
          className="truncate font-mono uppercase tracking-[0.06em] text-fin-text-muted"
          style={{ "font-size": "10px", "line-height": "1.1" }}
        >
          {props.title}
        </Text>
        <Show when={props.meta}>
          <Box className="flex shrink-0 items-center gap-2">{props.meta}</Box>
        </Show>
      </Box>

      <Box
        className={`flex min-w-0 flex-col gap-1${
          padded() ? " px-2 py-1.5" : " min-h-0 flex-1"
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
