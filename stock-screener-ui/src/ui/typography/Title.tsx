import { createMemo, splitProps } from "solid-js";
import { cn } from "../cn";
import * as palette from "../palette";
import type { JSX } from "solid-js";
import type { UITitleProps } from "../types";

const sizeMap: Record<string, string> = {
  xs: "0.75rem",
  sm: "0.875rem",
  md: "1rem",
  lg: "1.125rem",
  xl: "1.5rem",
};

const orderVariant: Record<number, "h1" | "h2" | "h3" | "h4" | "h5" | "h6"> = {
  1: "h1",
  2: "h2",
  3: "h3",
  4: "h4",
  5: "h5",
  6: "h6",
};

const TONE_CLASS: Record<string, string> = {
  primary: "text-fin-primary",
  secondary: "text-fin-text-muted",
  success: "text-fin-positive",
  error: "text-fin-negative",
  warning: "text-fin-warning",
  info: "text-fin-primary",
  danger: "text-fin-negative",
  dimmed: "text-fin-text-muted",
  default: "text-fin-text",
};

const TONE_COLOR: Record<string, string> = {
  primary: palette.PRIMARY,
  secondary: palette.TEXT_MUTED,
  success: palette.POSITIVE,
  error: palette.NEGATIVE,
  warning: palette.WARNING,
  info: palette.INFO,
  danger: palette.NEGATIVE,
  dimmed: palette.TEXT_MUTED,
  default: palette.TEXT,
};

function isLiteralColor(c: string): boolean {
  return c.startsWith("#") || c.startsWith("rgb") || c.includes(".");
}

const TITLE_TAGS: Record<string, (props: any) => JSX.Element> = {
  h1: (props) => <h1 {...props} />,
  h2: (props) => <h2 {...props} />,
  h3: (props) => <h3 {...props} />,
  h4: (props) => <h4 {...props} />,
  h5: (props) => <h5 {...props} />,
  h6: (props) => <h6 {...props} />,
  div: (props) => <div {...props} />,
};

const TITLE_KNOWN = [
  "children", "className", "style", "id", "data-testid", "onClick", "onMouseEnter", "onMouseLeave",
  "order", "c", "ta", "fw", "size", "lh", "component", "mt", "mb", "ml", "mr",
] as const;
// `title` is intentionally omitted: it is a native tooltip and must flow through
// `rest` onto the DOM element rather than being consumed here.

export function Title(props: UITitleProps) {
  const [known, rest] = splitProps(props, TITLE_KNOWN);

  const orderTag = known.order != null ? (orderVariant[known.order] ?? "h3") : "h3";
  const rootTag = (known.component ?? orderTag) as string;
  const Root = TITLE_TAGS[rootTag] ?? TITLE_TAGS["div"];

  const derived = createMemo(() => {
    const tone = known.c as string | undefined;
    const cls = tone != null ? TONE_CLASS[tone] : undefined;
    const o: Record<string, string | number | undefined> = {};
    if (tone != null) {
      o.color = TONE_COLOR[tone] ?? (isLiteralColor(tone) ? tone : undefined);
    }
    if (known.fw != null) o["font-weight"] = known.fw;
    if (known.ta != null) o["text-align"] = known.ta;
    if (known.lh != null) o["line-height"] = known.lh;
    if (known.size != null) {
      o["font-size"] = sizeMap[known.size as string] ?? (typeof known.size === "number" ? `${known.size}px` : known.size);
    }
    if (known.mt != null) o["margin-top"] = typeof known.mt === "number" ? `${known.mt * 8}px` : known.mt;
    if (known.mb != null) o["margin-bottom"] = typeof known.mb === "number" ? `${known.mb * 8}px` : known.mb;
    if (known.ml != null) o["margin-left"] = typeof known.ml === "number" ? `${known.ml * 8}px` : known.ml;
    if (known.mr != null) o["margin-right"] = typeof known.mr === "number" ? `${known.mr * 8}px` : known.mr;
    return { cls, style: o };
  });

  return (
    <Root
      className={cn(known.className, derived().cls)}
      style={{ ...derived().style, ...(known.style as Record<string, unknown> | undefined) }}
      id={known.id}
      data-testid={known["data-testid"]}
      onClick={known.onClick}
      onMouseEnter={known.onMouseEnter}
      onMouseLeave={known.onMouseLeave}
      {...rest}
    >
      {known.children}
    </Root>
  );
}
