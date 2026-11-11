import { cn } from "../cn";
import * as palette from "../palette";
import type { ElementType } from "react";
import type { UITextProps } from "../types";

const sizeMap: Record<string, string> = {
  xs: "0.75rem",
  sm: "0.875rem",
  md: "1rem",
  lg: "1.125rem",
  xl: "1.25rem",
};

function resolveSize(size: UITextProps["size"]): string | undefined {
  if (!size) return undefined;
  return sizeMap[size as string] ?? (size as string);
}

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

export function Text({
  children,
  className,
  style,
  onClick,
  onMouseEnter,
  onMouseLeave,
  "data-testid": testId,
  id,
  size,
  fw,
  c,
  ta,
  tt,
  lh,
  truncate,
  lineClamp,
  span,
  inherit,
  component,
  p, px, py, pt, pb, pl, pr,
  m, mx, my, mt, mb, ml, mr,
  w, maw, opacity, fs,
  ...rest
}: UITextProps) {
  const sp = (v: number | string | undefined) =>
    v == null ? undefined : typeof v === "number" ? `${v * 8}px` : v;
  // `inherit` is kept for API parity (MUI's `variant="inherit"` had no effect
  // semantic elements inherit by default.
  void inherit;

  const tone = c as string | undefined;
  const cls = tone != null ? TONE_CLASS[tone] : undefined;
  const styleObj: React.CSSProperties = {};
  if (tone != null) {
    styleObj.color = TONE_COLOR[tone] ?? (isLiteralColor(tone) ? tone : undefined);
  }
  if (fw != null) styleObj.fontWeight = fw;
  if (ta != null) styleObj.textAlign = ta;
  if (tt != null) styleObj.textTransform = tt;
  if (lh != null) styleObj.lineHeight = lh;
  if (size != null) styleObj.fontSize = resolveSize(size);
  if (fs != null) styleObj.fontStyle = fs;
  if (p != null) styleObj.padding = sp(p);
  if (px != null) { styleObj.paddingLeft = sp(px); styleObj.paddingRight = sp(px); }
  if (py != null) { styleObj.paddingTop = sp(py); styleObj.paddingBottom = sp(py); }
  if (pt != null) styleObj.paddingTop = sp(pt);
  if (pb != null) styleObj.paddingBottom = sp(pb);
  if (pl != null) styleObj.paddingLeft = sp(pl);
  if (pr != null) styleObj.paddingRight = sp(pr);
  if (m != null) styleObj.margin = sp(m);
  if (mx != null) { styleObj.marginLeft = sp(mx); styleObj.marginRight = sp(mx); }
  if (my != null) { styleObj.marginTop = sp(my); styleObj.marginBottom = sp(my); }
  if (mt != null) styleObj.marginTop = sp(mt);
  if (mb != null) styleObj.marginBottom = sp(mb);
  if (ml != null) styleObj.marginLeft = sp(ml);
  if (mr != null) styleObj.marginRight = sp(mr);
  if (w != null) styleObj.width = typeof w === "number" ? `${w}px` : w;
  if (maw != null) styleObj.maxWidth = typeof maw === "number" ? `${maw}px` : maw;
  if (opacity != null) styleObj.opacity = opacity;

  if (truncate) {
    styleObj.overflow = "hidden";
    styleObj.textOverflow = "ellipsis";
    styleObj.whiteSpace = "nowrap";
    if (truncate === "start") {
      styleObj.direction = "rtl";
      styleObj.textAlign = "left";
    }
  }

  if (lineClamp != null) {
    styleObj.display = "-webkit-box";
    styleObj.WebkitLineClamp = lineClamp;
    styleObj.WebkitBoxOrient = "vertical";
    styleObj.overflow = "hidden";
  }

  const Component = (component ?? (span ? "span" : "p")) as ElementType;

  return (
    <Component
      className={cn(className, cls)}
      style={{ ...styleObj, ...style }}
      id={id}
      data-testid={testId}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </Component>
  );
}
