import { createMemo, splitProps } from "solid-js";
import { cn } from "../cn";
import { TYPE_CLASS, type TypeRole } from "../typography";
import type { JSX } from "solid-js";
import type { UITextProps } from "../types";

/**
 * Alias → shared tier. Body-sized text tops out at `heading`: `display` (24px)
 * is a page-title step and breaks body copy. Unknown/custom sizes carry no
 * class: a caller needing a one-off size passes a `text-ui-*` className or
 * `typeStyle()` explicitly, never an implicit private font-size here.
 */
const SIZE_ROLE: Record<string, TypeRole> = {
  xs: "micro",
  sm: "label",
  md: "title",
  lg: "heading",
  xl: "heading",
};

function sizeClass(size: UITextProps["size"]): string | undefined {
  if (size == null) return undefined;
  const role = SIZE_ROLE[String(size)];
  return role ? TYPE_CLASS[role] : undefined;
}

/**
 * Tones are utilities, not inline colours: an inline `color` beats both the
 * light-theme token override and any `className` the caller passes.
 */
const TONE_CLASS: Record<string, string> = {
  primary: "text-fin-primary",
  secondary: "text-fin-text-muted",
  success: "text-fin-positive",
  error: "text-fin-negative",
  warning: "text-fin-warning",
  info: "text-fin-info",
  danger: "text-fin-negative",
  dimmed: "text-fin-text-muted",
  default: "text-fin-text",
};

/** `c` also takes a raw colour; that is the one case an inline value is correct. */
function isLiteralColor(c: string): boolean {
  return /^(#|rgba?\(|hsla?\()/i.test(c);
}

const TEXT_KNOWN = [
  "children", "className", "class", "style", "id", "data-testid", "onClick", "onMouseEnter", "onMouseLeave",
  "size", "fw", "c", "ta", "tt", "lh", "fs", "truncate", "lineClamp", "span", "inherit", "component",
  "p", "px", "py", "pt", "pb", "pl", "pr", "m", "mx", "my", "mt", "mb", "ml", "mr",
  "w", "maw", "opacity",
] as const;
// `title` is intentionally omitted: it is a native tooltip and must flow through
// `rest` onto the DOM element rather than being consumed here.

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
    if (tone != null && cls == null && isLiteralColor(tone)) o.color = tone;
    if (known.fw != null) o["font-weight"] = known.fw;
    if (known.ta != null) o["text-align"] = known.ta;
    if (known.tt != null) o["text-transform"] = known.tt;
    if (known.lh != null) o["line-height"] = known.lh;
    if (known.fs != null) o.fontStyle = known.fs;
    if (known.p != null) o.padding = sp(known.p);
    if (known.px != null) { o["padding-left"] = sp(known.px); o["padding-right"] = sp(known.px); }
    if (known.py != null) { o["padding-top"] = sp(known.py); o["padding-bottom"] = sp(known.py); }
    if (known.pt != null) o["padding-top"] = sp(known.pt);
    if (known.pb != null) o["padding-bottom"] = sp(known.pb);
    if (known.pl != null) o["padding-left"] = sp(known.pl);
    if (known.pr != null) o["padding-right"] = sp(known.pr);
    if (known.m != null) o.margin = sp(known.m);
    if (known.mx != null) { o["margin-left"] = sp(known.mx); o["margin-right"] = sp(known.mx); }
    if (known.my != null) { o["margin-top"] = sp(known.my); o["margin-bottom"] = sp(known.my); }
    if (known.mt != null) o["margin-top"] = sp(known.mt);
    if (known.mb != null) o["margin-bottom"] = sp(known.mb);
    if (known.ml != null) o["margin-left"] = sp(known.ml);
    if (known.mr != null) o["margin-right"] = sp(known.mr);
    if (known.w != null) o.width = typeof known.w === "number" ? `${known.w}px` : known.w;
    if (known.maw != null) o["max-width"] = typeof known.maw === "number" ? `${known.maw}px` : known.maw;
    if (known.opacity != null) o.opacity = known.opacity;
    if (known.truncate) {
      o.overflow = "hidden";
      o["text-overflow"] = "ellipsis";
      o["white-space"] = "nowrap";
      if (known.truncate === "start") {
        o.direction = "rtl";
        o["text-align"] = "left";
      }
    }
    if (known.lineClamp != null) {
      o.display = "-webkit-box";
      o["webkit-line-clamp"] = known.lineClamp;
      o.WebkitBoxOrient = "vertical";
      o.overflow = "hidden";
    }
    return { cls, style: o };
  });

  const rootTag = (known.component ?? (known.span ? "span" : "p")) as string;
  const Root = TEXT_TAGS[rootTag] ?? TEXT_TAGS["div"];

  return (
    <Root
      className={cn(known.className, known.class, derived().cls, sizeClass(known.size))}
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
