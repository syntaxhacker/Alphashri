import { createMemo, splitProps } from "solid-js";
import { cn } from "../cn";
import * as palette from "../palette";
import type { JSX } from "solid-js";
import type { UIAnchorProps } from "../types";

const sizeMap: Record<string, string> = {
  xs: "0.75rem",
  sm: "0.875rem",
  md: "1rem",
  lg: "1.125rem",
  xl: "1.25rem",
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

const ANCHOR_TAGS: Record<string, (props: any) => JSX.Element> = {
  a: (props) => <a {...props} />,
  span: (props) => <span {...props} />,
  div: (props) => <div {...props} />,
};

const ANCHOR_KNOWN = [
  "children", "className", "style", "id", "data-testid", "onClick", "onMouseEnter", "onMouseLeave",
  "href", "target", "underline", "size", "fw", "c", "ta", "lh", "span", "truncate", "lineClamp",
  "inherit", "component",
] as const;
// `title` is intentionally omitted: it is a native tooltip and must flow through
// `rest` onto the DOM element rather than being consumed here.

export function Anchor(props: UIAnchorProps) {
  const [known, rest] = splitProps(props, ANCHOR_KNOWN);
  // `inherit` is kept for API parity — semantic elements inherit by default.
  void known.inherit;

  const derived = createMemo(() => {
    const tone = known.c as string | undefined;
    const cls = tone != null ? TONE_CLASS[tone] : undefined;
    const underlineProp = known.underline === "always" ? "always" : known.underline === "never" ? "none" : "hover";
    const o: Record<string, string | number | undefined> = { cursor: "pointer" };
    if (tone != null) {
      o.color = TONE_COLOR[tone] ?? (isLiteralColor(tone) ? tone : undefined);
    }
    if (known.fw != null) o.fontWeight = known.fw;
    if (known.ta != null) o.textAlign = known.ta;
    if (known.lh != null) o.lineHeight = known.lh;
    if (known.size != null) o.fontSize = sizeMap[known.size as string] ?? (known.size as string);

    let underlineClass: string | undefined;
    if (underlineProp === "always") {
      o.textDecoration = "underline";
    } else if (underlineProp === "none") {
      o.textDecoration = "none";
    } else {
      // "hover": no underline by default, underline on hover.
      o.textDecoration = "none";
      underlineClass = "hover:underline";
    }

    if (known.truncate) {
      o.overflow = "hidden";
      o.textOverflow = "ellipsis";
      o.whiteSpace = "nowrap";
      o.display = "inline-block";
      o.maxWidth = "100%";
    }

    if (known.lineClamp != null) {
      o.display = "-webkit-box";
      o.WebkitLineClamp = known.lineClamp;
      o.WebkitBoxOrient = "vertical";
      o.overflow = "hidden";
    }

    return { cls, style: o, underlineClass };
  });

  const rootTag = (known.component ?? (known.span ? "span" : "a")) as string;
  const Root = ANCHOR_TAGS[rootTag] ?? ANCHOR_TAGS["a"];

  return (
    <Root
      {...(rootTag === "a" ? { href: known.href, target: known.target } : {})}
      className={cn(known.className, derived().cls, derived().underlineClass)}
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
