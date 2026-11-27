import { splitProps } from "solid-js";
import type { JSX } from "solid-js";
import { cn } from "../cn";

export type ColAlign = "start" | "center" | "end" | "stretch";

// Full literal class names keep Tailwind's scanner able to see every variant.
const SPAN: Record<number, string> = {
  1: "col-span-1", 2: "col-span-2", 3: "col-span-3", 4: "col-span-4",
  5: "col-span-5", 6: "col-span-6", 7: "col-span-7", 8: "col-span-8",
  9: "col-span-9", 10: "col-span-10", 11: "col-span-11", 12: "col-span-12",
};
const SM_SPAN: Record<number, string> = {
  1: "sm:col-span-1", 2: "sm:col-span-2", 3: "sm:col-span-3", 4: "sm:col-span-4",
  5: "sm:col-span-5", 6: "sm:col-span-6", 7: "sm:col-span-7", 8: "sm:col-span-8",
  9: "sm:col-span-9", 10: "sm:col-span-10", 11: "sm:col-span-11", 12: "sm:col-span-12",
};
const MD_SPAN: Record<number, string> = {
  1: "md:col-span-1", 2: "md:col-span-2", 3: "md:col-span-3", 4: "md:col-span-4",
  5: "md:col-span-5", 6: "md:col-span-6", 7: "md:col-span-7", 8: "md:col-span-8",
  9: "md:col-span-9", 10: "md:col-span-10", 11: "md:col-span-11", 12: "md:col-span-12",
};
const LG_SPAN: Record<number, string> = {
  1: "lg:col-span-1", 2: "lg:col-span-2", 3: "lg:col-span-3", 4: "lg:col-span-4",
  5: "lg:col-span-5", 6: "lg:col-span-6", 7: "lg:col-span-7", 8: "lg:col-span-8",
  9: "lg:col-span-9", 10: "lg:col-span-10", 11: "lg:col-span-11", 12: "lg:col-span-12",
};

const SELF: Record<ColAlign, string> = {
  start: "self-start",
  center: "self-center",
  end: "self-end",
  stretch: "self-stretch",
};

const clampSpan = (n: number) => Math.min(12, Math.max(1, Math.round(n)));

export interface ColProps {
  children?: JSX.Element;
  className?: string;
  style?: JSX.CSSProperties;
  id?: string;
  "data-testid"?: string;
  /** Base span out of 12 (1-12). */
  span?: number;
  /** Span from the `sm` breakpoint up. */
  sm?: number;
  /** Span from the `md` breakpoint up. */
  md?: number;
  /** Span from the `lg` breakpoint up. */
  lg?: number;
  order?: number;
  align?: ColAlign;
}

export function Col(props: ColProps) {
  const [known, rest] = splitProps(props, [
    "children", "className", "style", "id", "data-testid", "span", "sm", "md", "lg", "order", "align",
  ] as const);

  const span = known.span != null ? clampSpan(known.span) : undefined;
  const sm = known.sm != null ? clampSpan(known.sm) : undefined;
  const md = known.md != null ? clampSpan(known.md) : undefined;
  const lg = known.lg != null ? clampSpan(known.lg) : undefined;

  return (
    <div
      id={known.id}
      className={cn(
        "min-w-0",
        span != null ? SPAN[span] : undefined,
        sm != null ? SM_SPAN[sm] : undefined,
        md != null ? MD_SPAN[md] : undefined,
        lg != null ? LG_SPAN[lg] : undefined,
        known.align ? SELF[known.align] : undefined,
        known.className,
      )}
      style={{
        ...(known.order != null ? { order: known.order } : {}),
        ...(known.style as Record<string, unknown> | undefined),
      }}
      data-testid={known["data-testid"]}
      {...rest}
    >
      {known.children}
    </div>
  );
}
