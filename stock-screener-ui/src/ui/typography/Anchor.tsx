import { cn } from "../cn";
import * as palette from "../palette";
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

export function Anchor({
  children,
  href,
  target,
  underline,
  onClick,
  onMouseEnter,
  onMouseLeave,
  size,
  fw,
  c,
  ta,
  lh,
  span,
  truncate,
  lineClamp,
  inherit,
  component,
  className,
  style,
  id,
  "data-testid": testId,
  ...rest
}: UIAnchorProps) {
  // `inherit` is kept for API parity (MUI's `variant="inherit"` had no effect
  // semantic elements inherit by default.
  void inherit;

  const Element: React.ElementType = component ?? (span ? "span" : "a");

  const tone = c as string | undefined;
  const cls = tone != null ? TONE_CLASS[tone] : undefined;
  const underlineProp: "always" | "hover" | "none" =
    underline === "always" ? "always" : underline === "never" ? "none" : "hover";

  const styleObj: React.CSSProperties = { cursor: "pointer" };
  if (tone != null) {
    styleObj.color = TONE_COLOR[tone] ?? (isLiteralColor(tone) ? tone : undefined);
  }
  if (fw != null) styleObj.fontWeight = fw;
  if (ta != null) styleObj.textAlign = ta;
  if (lh != null) styleObj.lineHeight = lh;
  if (size != null) styleObj.fontSize = sizeMap[size as string] ?? (size as string);

  let underlineClass: string | undefined;
  if (underlineProp === "always") {
    styleObj.textDecoration = "underline";
  } else if (underlineProp === "none") {
    styleObj.textDecoration = "none";
  } else {
    // "hover": no underline by default, underline on hover.
    styleObj.textDecoration = "none";
    underlineClass = "hover:underline";
  }

  if (truncate) {
    styleObj.overflow = "hidden";
    styleObj.textOverflow = "ellipsis";
    styleObj.whiteSpace = "nowrap";
    styleObj.display = "inline-block";
    styleObj.maxWidth = "100%";
  }

  if (lineClamp != null) {
    styleObj.display = "-webkit-box";
    styleObj.WebkitLineClamp = lineClamp;
    styleObj.WebkitBoxOrient = "vertical";
    styleObj.overflow = "hidden";
  }

  // `href`/`target` only apply to real anchors.
  const linkProps = Element === "a" ? { href, target } : {};

  return (
    <Element
      {...linkProps}
      className={cn(className, cls, underlineClass)}
      style={{ ...styleObj, ...style }}
      id={id}
      data-testid={testId}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </Element>
  );
}
