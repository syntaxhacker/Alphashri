import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { useTheme } from "@mui/material/styles";
import type { UIBaseProps, UIColor } from "../types";

export interface UIRingProgressProps extends UIBaseProps {
  value: number;
  size?: number;
  thickness?: number;
  roundCaps?: boolean;
  color?: UIColor;
  label?: React.ReactNode;
  sections?: { value: number; color: UIColor; tooltip?: string }[];
}

function useResolveColor() {
  const theme = useTheme();
  const palette = theme.palette as unknown as Record<string, { main: string }>;
  return (c?: string): string => {
    if (!c) return palette.primary?.main ?? theme.palette.primary.main;
    if (c.startsWith("#") || c.startsWith("rgb")) return c;
    const key = c.split(".")[0];
    const entry = palette[key];
    if (entry?.main) return entry.main;
    // fallback to MUI palette lookup via theme
    const mui = (theme.palette as unknown as Record<string, { main: string }>)[c];
    if (mui?.main) return mui.main;
    return c;
  };
}

export function RingProgress({ sections, color, value, label, size = 80, thickness = 8, roundCaps, className, style, "data-testid": testId, id }: UIRingProgressProps) {
  const effSections = sections ?? [{ value, color: (color as string) ?? "primary" }];
  const resolveColor = useResolveColor();
  const theme = useTheme();
  const trackColor = (theme.palette as unknown as Record<string, { main: string }>).grey?.[200] ?? theme.palette.divider ?? theme.palette.grey[200];

  // Build conic-gradient from sections
  let acc = 0;
  const stops: string[] = [];
  for (const s of effSections) {
    const start = acc;
    const end = acc + s.value;
    const col = resolveColor(s.color as string);
    stops.push(`${col} ${start}% ${end}%`);
    acc = end;
  }
  if (acc < 100) {
    stops.push(`${trackColor} ${acc}% 100%`);
  }
  const conic = `conic-gradient(${stops.join(", ")})`;

  return (
    <Box
      className={className}
      style={style}
      id={id}
      data-testid={testId}
      sx={{
        position: "relative",
        width: size,
        height: size,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: conic,
        // mask inner hole
        "&::before": {
          content: '""',
          position: "absolute",
          inset: thickness,
          borderRadius: "50%",
          bgcolor: "background.paper",
        },
      }}
    >
      {/* Fallback CircularProgress for a11y/roundCaps visual: hidden but keeps semantics */}
      <CircularProgress
        variant="determinate"
        value={100}
        size={size}
        thickness={(thickness / size) * 100}
        sx={{ position: "absolute", color: "transparent", "& .MuiCircularProgress-circle": { strokeLinecap: roundCaps ? "round" : "butt" } }}
      />
      <Box sx={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>{label}</Box>
    </Box>
  );
}
