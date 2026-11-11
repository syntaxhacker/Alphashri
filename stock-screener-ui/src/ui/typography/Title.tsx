import { cn } from "../cn";
import * as palette from "../palette";
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

export function Title({
  children,
  order,
  c,
  ta,
  fw,
  size,
  lh,
  component,
  mt,
  mb,
  ml,
  mr,
  className,
  style,
  id,
  "data-testid": testId,
  onClick,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: UITitleProps) {
  const tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" =
    order != null ? (orderVariant[order] ?? "h3") : "h3";

  const tone = c as string | undefined;
  const cls = tone != null ? TONE_CLASS[tone] : undefined;
  const styleObj: React.CSSProperties = {};
  if (tone != null) {
    styleObj.color = TONE_COLOR[tone] ?? (isLiteralColor(tone) ? tone : undefined);
  }
  if (fw != null) styleObj.fontWeight = fw;
  if (ta != null) styleObj.textAlign = ta;
  if (lh != null) styleObj.lineHeight = lh;
  if (size != null) {
    styleObj.fontSize = sizeMap[size as string] ?? (typeof size === "number" ? `${size}px` : size);
  }
  if (mt != null) styleObj.marginTop = typeof mt === "number" ? `${mt * 8}px` : mt;
  if (mb != null) styleObj.marginBottom = typeof mb === "number" ? `${mb * 8}px` : mb;
  if (ml != null) styleObj.marginLeft = typeof ml === "number" ? `${ml * 8}px` : ml;
  if (mr != null) styleObj.marginRight = typeof mr === "number" ? `${mr * 8}px` : mr;

  const Component = (component ?? tag) as ElementType;

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
