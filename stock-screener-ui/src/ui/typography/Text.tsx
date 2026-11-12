import { createMemo, splitProps } from "solid-js";
import { cn } from "../cn";
import * as palette from "../palette";
import type { JSX } from "solid-js";
import type { UITextProps } from "../types";

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

const TEXT_KNOWN = [
  "children", "className", "style", "id", "data-testid", "onClick", "onMouseEnter", "onMouseLeave",
  "size", "fw", "c", "ta", "lh", "fs", "truncate", "lineClamp", "span", "inherit", "component",
  "p", "px", "py", "pt", "pb", "pl", "pr", "m", "mx", "my", "mt", "mb", "ml", "mr",
  "w", "maw", "opacity",
] as const;
// `title` is intentionally omitted: it is a native tooltip and must flow through
// `rest` onto the DOM element rather than being consumed here.

function resolveSize(size: UITextProps["size"]): string | undefined {
  if (!size) return undefined;
  return sizeMap[size as string] ?? (size as string);
}

const sp = (v: number | string | undefined) =>
  v == null ? undefined : typeof v === "number" ? `${v * 8}px` : v;

// Solid cannot render a dynamic intrinsic tag via `<Tag>` when Tag is a string
// (createComponent calls it as a function). Resolve through a small intrinsic
// registry so any `keyof JSX.IntrinsicElements` works.
const TEXT_TAGS: Record<string, (props: any) => JSX.Element> = {
  p: (props) => <p {...props} />,
  span: (props) => <span {...props} />,
  div: (props) => <div {...props} />,
  a: (props) => <a {...props} />,
  h1: (props) => <h1 {...props} />,
  h2: (props) => <h2 {...props} />,
  h3: (props) => <h3 {...props} />,
  h4: (props) => <h4 {...props} />,
  h5: (props) => <h5 {...props} />,
  h6: (props) => <h6 {...props} />,
  code: (props) => <code {...props} />,
  pre: (props) => <pre {...props} />,
};

export function Text(props: UITextProps) {
  const [known, rest] = splitProps(props, TEXT_KNOWN);
  // `inherit` is kept for API parity — semantic elements inherit by default.
  void known.inherit;

  const derived = createMemo(() => {
    const tone = known.c as string | undefined;
    const cls = tone != null ? TONE_CLASS[tone] : undefined;
    const o: Record<string, string | number | undefined> = {};
    if (tone != null) {
      o.color = TONE_COLOR[tone] ?? (isLiteralColor(tone) ? tone : undefined);
    }
    if (known.fw != null) o.fontWeight = known.fw;
    if (known.ta != null) o.textAlign = known.ta;
    if (known.lh != null) o.lineHeight = known.lh;
    if (known.size != null) o.fontSize = resolveSize(known.size);
    if (known.fs != null) o.fontStyle = known.fs;
    if (known.p != null) o.padding = sp(known.p);
    if (known.px != null) { o.paddingLeft = sp(known.px); o.paddingRight = sp(known.px); }
    if (known.py != null) { o.paddingTop = sp(known.py); o.paddingBottom = sp(known.py); }
    if (known.pt != null) o.paddingTop = sp(known.pt);
    if (known.pb != null) o.paddingBottom = sp(known.pb);
    if (known.pl != null) o.paddingLeft = sp(known.pl);
    if (known.pr != null) o.paddingRight = sp(known.pr);
    if (known.m != null) o.margin = sp(known.m);
    if (known.mx != null) { o.marginLeft = sp(known.mx); o.marginRight = sp(known.mx); }
    if (known.my != null) { o.marginTop = sp(known.my); o.marginBottom = sp(known.my); }
    if (known.mt != null) o.marginTop = sp(known.mt);
    if (known.mb != null) o.marginBottom = sp(known.mb);
    if (known.ml != null) o.marginLeft = sp(known.ml);
    if (known.mr != null) o.marginRight = sp(known.mr);
    if (known.w != null) o.width = typeof known.w === "number" ? `${known.w}px` : known.w;
    if (known.maw != null) o.maxWidth = typeof known.maw === "number" ? `${known.maw}px` : known.maw;
    if (known.opacity != null) o.opacity = known.opacity;
    if (known.truncate) {
      o.overflow = "hidden";
      o.textOverflow = "ellipsis";
      o.whiteSpace = "nowrap";
      if (known.truncate === "start") {
        o.direction = "rtl";
        o.textAlign = "left";
      }
    }
    if (known.lineClamp != null) {
      o.display = "-webkit-box";
      o.WebkitLineClamp = known.lineClamp;
      o.WebkitBoxOrient = "vertical";
      o.overflow = "hidden";
    }
    return { cls, style: o };
  });

  const rootTag = (known.component ?? (known.span ? "span" : "p")) as string;
  const Root = TEXT_TAGS[rootTag] ?? TEXT_TAGS["div"];

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
