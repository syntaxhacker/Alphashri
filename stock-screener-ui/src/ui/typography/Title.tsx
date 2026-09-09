import Typography from "@mui/material/Typography";
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

export function Title({
  children,
  order,
  c,
  ta,
  fw,
  size,
  lh,
  className,
  style,
  "data-testid": testId,
  id,
  onClick,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: UITitleProps) {
  const variant = order != null ? orderVariant[order] ?? "h3" : "h3";
  const component = order != null ? (`h${order}` as "h1") : "h3";

  const sx: Record<string, unknown> = {
    ...(c != null && { color: c as string }),
    ...(fw != null && { fontWeight: fw }),
    ...(ta != null && { textAlign: ta }),
    ...(lh != null && { lineHeight: lh }),
    ...(size != null && {
      fontSize: (sizeMap[size as string] ?? (typeof size === "number" ? `${size}px` : (size as string))),
    }),
  };

  return (
    <Typography
      variant={variant}
      component={component}
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
