import CircularProgress from "@mui/material/CircularProgress";
import type { UILoaderProps } from "../types";

function resolveSize(size: UILoaderProps["size"]): number | undefined {
  if (size == null) return undefined;
  if (typeof size === "number") return size;
  if (typeof size === "string" && !isNaN(Number(size))) return Number(size);
  const map: Record<string, number> = { xs: 16, sm: 20, md: 28, lg: 36, xl: 44 };
  return map[size as string] ?? undefined;
}

export function Loader({ className, style, "data-testid": testId, id, size, color, ...rest }: UILoaderProps) {
  const px = resolveSize(size);
  // color is decorative; CircularProgress uses palette via color prop, but custom hex via sx
  const isHex = color != null && String(color).startsWith("#");
  return (
    <CircularProgress
      size={px ?? 28}
      className={className}
      style={style}
      id={id}
      data-testid={testId}
      sx={isHex ? { color: color as string } : undefined}
      {...(rest as Record<string, unknown>)}
    />
  );
}
