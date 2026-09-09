import MuiAvatar from "@mui/material/Avatar";
import type { UIAvatarProps } from "../types";

function mapSize(size: UIAvatarProps["size"]): { sx: Record<string, unknown> } {
  if (size == null) return { sx: {} };
  if (typeof size === "number") return { sx: { width: size, height: size, fontSize: size * 0.4 } };
  if (typeof size === "string" && !isNaN(Number(size))) {
    const n = Number(size);
    return { sx: { width: n, height: n, fontSize: n * 0.4 } };
  }
  const map: Record<string, number> = { xs: 24, sm: 32, md: 40, lg: 48, xl: 56 };
  const px = map[size as string];
  if (px) return { sx: { width: px, height: px, fontSize: px * 0.4 } };
  return { sx: {} };
}

export function Avatar({ src, alt, color, radius, size, children, className, style, "data-testid": testId, id, ...rest }: UIAvatarProps) {
  const { sx: sizeSx } = mapSize(size);
  const sx: Record<string, unknown> = {
    ...sizeSx,
    ...(color ? { bgcolor: color as string } : {}),
    ...(radius != null
      ? {
          borderRadius:
            typeof radius === "number"
              ? `${radius}px`
              : radius === "xs"
                ? "4px"
                : radius === "xl"
                  ? "16px"
                  : undefined,
        }
      : {}),
  };

  return (
    <MuiAvatar
      src={src ?? undefined}
      alt={alt}
      className={className}
      style={style}
      id={id}
      data-testid={testId}
      sx={sx}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </MuiAvatar>
  );
}
