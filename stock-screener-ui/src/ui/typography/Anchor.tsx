import MuiLink from "@mui/material/Link";
import type { UIAnchorProps } from "../types";

const sizeMap: Record<string, string> = {
  xs: "0.75rem",
  sm: "0.875rem",
  md: "1rem",
  lg: "1.125rem",
  xl: "1.25rem",
};

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
  "data-testid": testId,
  id,
  ...rest
}: UIAnchorProps) {
  const sx: Record<string, unknown> = {
    cursor: "pointer",
    ...(c != null && { color: c as string }),
    ...(fw != null && { fontWeight: fw }),
    ...(ta != null && { textAlign: ta }),
    ...(lh != null && { lineHeight: lh }),
    ...(size != null && { fontSize: sizeMap[size as string] ?? (size as string) }),
  };

  if (truncate) {
    Object.assign(sx, {
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      display: "inline-block",
      maxWidth: "100%",
    });
  }
  if (lineClamp != null) {
    Object.assign(sx, {
      display: "-webkit-box",
      WebkitLineClamp: lineClamp,
      WebkitBoxOrient: "vertical" as const,
      overflow: "hidden",
    });
  }

  const underlineProp: "always" | "hover" | "none" =
    underline === "always" ? "always" : underline === "never" ? "none" : "hover";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const LinkAny = MuiLink as any;
  return (
    <LinkAny
      href={href}
      target={target}
      underline={underlineProp}
      component={(component as never) ?? (span ? "span" : "a")}
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
    </LinkAny>
  );
}
