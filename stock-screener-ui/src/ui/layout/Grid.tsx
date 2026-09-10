import MuiGrid from "@mui/material/Grid";
import type { UIGridProps, UIGridColProps } from "../types";

const sp = (v: unknown) => {
  if (v == null) return undefined;
  if (typeof v === "number") return `${v}px`;
  const m: Record<string, string> = { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" };
  return (m[v as string] ?? v) as string;
};

const spNum = (v: unknown) => {
  if (v == null) return undefined;
  if (typeof v === "number") return v / 8;
  const m: Record<string, number> = { xs: 0.5, sm: 1, md: 2, lg: 3, xl: 4 };
  return (m[v as string] ?? 1) as number;
};

export function GridCol({ children, className, style, id, "data-testid": testId, span, offset, order, ...rest }: UIGridColProps & Record<string, unknown>) {
  const size = span != null && span !== "auto" && span !== "content" ? span : undefined;
  return (
    <MuiGrid
      id={id as string} className={className} style={style} data-testid={testId}
      size={size != null ? { xs: size } : undefined}
      sx={{ ...(order != null && { order }), ...(offset != null && { ml: `${(Number(offset) / 12) * 100}%` }) }}
      {...rest}
    >{children}</MuiGrid>
  );
}

export function Grid({ children, className, style, id, "data-testid": testId, gutter, columns, grow, ...rest }: UIGridProps & Record<string, unknown>) {
  void columns; void grow;
  return (
    <MuiGrid
      container
      id={id as string} className={className} style={style} data-testid={testId}
      spacing={gutter != null ? spNum(gutter) : undefined} {...rest}
    >{children}</MuiGrid>
  );
}
Grid.Col = GridCol;
