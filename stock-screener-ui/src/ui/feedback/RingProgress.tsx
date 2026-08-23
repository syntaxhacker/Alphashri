import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
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

function resolveColor(c?: string): string {
  if (!c) return "#2563EB";
  // Map Mantine names to MUI palette hex fallback
  const map: Record<string, string> = {
    teal: "#0FAE99",
    green: "#16A34A",
    red: "#DC2626",
    orange: "#D97706",
    blue: "#2563EB",
    gray: "#64748B",
    dark: "#1E293B",
    yellow: "#D97706",
    violet: "#8250DF",
    pink: "#E64980",
    cyan: "#0891B2",
  };
  return map[c] ?? c;
}

export function RingProgress({ sections, color, value, label, size = 80, thickness = 8, roundCaps, className, style, "data-testid": testId, id }: UIRingProgressProps) {
  const effSections = sections ?? [{ value, color: (color as string) ?? "blue" }];

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
    stops.push(`#E2E8F0 ${acc}% 100%`);
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
