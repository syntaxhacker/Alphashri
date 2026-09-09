import Typography from "@mui/material/Typography";
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

function resolveColor(c: string): string {
  const map: Record<string, string> = {
    success: "success.main",
    error: "error.main",
    warning: "warning.main",
    info: "info.main",
    primary: "primary.main",
    secondary: "text.secondary",
    dimmed: "text.secondary",
    default: "text.primary",
  };
  if (!c) return c;
  if (c.startsWith("#") || c.startsWith("rgb") || c.includes(".")) return c;
  return map[c] ?? c;
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
  ...rest
}: UITextProps) {
  const sx: Record<string, unknown> = {
    ...(c != null && { color: resolveColor(c as string) }),
    ...(fw != null && { fontWeight: fw }),
    ...(ta != null && { textAlign: ta }),
    ...(tt != null && { textTransform: tt }),
    ...(lh != null && { lineHeight: lh }),
    ...(size != null && { fontSize: resolveSize(size as UITextProps["size"]) }),
  };

  if (truncate) {
    Object.assign(sx, {
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    if (truncate === "start") {
      Object.assign(sx, { direction: "rtl", textAlign: "left" as const });
    }
  }

  if (lineClamp != null) {
    Object.assign(sx, {
      display: "-webkit-box",
      WebkitLineClamp: lineClamp,
      WebkitBoxOrient: "vertical" as const,
      overflow: "hidden",
    });
  }

  return (
    <Typography
      component={span ? "span" : "p"}
      variant={inherit ? "inherit" : "body2"}
      className={className}
      style={style}
      id={id}
      data-testid={testId}
      onClick={onClick as never}
      onMouseEnter={onMouseEnter as never}
      onMouseLeave={onMouseLeave as never}
      sx={sx}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </Typography>
  );
}
