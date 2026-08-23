import LinearProgress from "@mui/material/LinearProgress";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { UIProgressProps } from "../types";

function resolveBarColor(color?: string): string | undefined {
  if (!color) return undefined;
  // Pass hex directly via sx; named Mantine colors map to hex via css fallback
  return color as string;
}

function toHeight(size: UIProgressProps["size"]): number | string | undefined {
  if (size == null) return undefined;
  if (typeof size === "number") return `${size}px`;
  const map: Record<string, string> = { xs: "4px", sm: "8px", md: "12px", lg: "16px", xl: "20px" };
  return map[size as string] ?? (size as string);
}

export function Progress({
  value,
  color,
  size,
  radius,
  striped,
  animated,
  label,
  sections,
  transitionDuration,
  className,
  style,
  "data-testid": testId,
  id,
  ...rest
}: UIProgressProps) {
  const h = toHeight(size);
  const br =
    radius != null
      ? typeof radius === "number"
        ? `${radius}px`
        : radius === "xs"
          ? "4px"
          : radius === "xl"
            ? "16px"
            : "4px"
      : undefined;

  if (sections && sections.length > 0) {
    return (
      <Box
        className={className}
        style={style}
        id={id}
        data-testid={testId}
        sx={{
          display: "flex",
          width: "100%",
          height: h ?? 8,
          borderRadius: br,
          overflow: "hidden",
          bgcolor: "action.hover",
          gap: 0,
        }}
        {...(rest as Record<string, unknown>)}
      >
        {sections.map((section, i) => (
          <Box
            key={i}
            sx={{
              width: `${section.value}%`,
              bgcolor: resolveBarColor(section.color) ?? "primary.main",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              ...(striped
                ? {
                    backgroundImage:
                      "repeating-linear-gradient(45deg, rgba(255,255,255,0.15) 0 8px, transparent 8px 16px)",
                  }
                : {}),
              ...(animated && striped
                ? {
                    animation: "mui-progress-stripes 1s linear infinite",
                    "@keyframes mui-progress-stripes": {
                      "0%": { backgroundPosition: "0 0" },
                      "100%": { backgroundPosition: "16px 0" },
                    },
                  }
                : {}),
              transition: transitionDuration != null ? `width ${transitionDuration}ms` : undefined,
              borderRadius: 0,
            }}
          >
            {(label || section.label) && (
              <Typography variant="caption" sx={{ color: "common.white", fontWeight: 600, fontSize: "0.7rem", lineHeight: 1 }}>
                {section.label ?? label}
              </Typography>
            )}
          </Box>
        ))}
      </Box>
    );
  }

  return (
    <Box
      className={className}
      style={style}
      id={id}
      data-testid={testId}
      sx={{ position: "relative", width: "100%" }}
      {...(rest as Record<string, unknown>)}
    >
      <LinearProgress
        variant="determinate"
        value={Math.max(0, Math.min(100, value ?? 0))}
        sx={{
          height: h ?? 8,
          borderRadius: br,
          bgcolor: "action.hover",
          "& .MuiLinearProgress-bar": {
            bgcolor: resolveBarColor(color) ?? "primary.main",
            borderRadius: br,
            ...(striped
              ? {
                  backgroundImage:
                    "repeating-linear-gradient(45deg, rgba(255,255,255,0.15) 0 8px, transparent 8px 16px)",
                }
              : {}),
            ...(animated && striped
              ? {
                  animation: "mui-progress-stripes 1s linear infinite",
                  "@keyframes mui-progress-stripes": {
                    "0%": { backgroundPosition: "0 0" },
                    "100%": { backgroundPosition: "16px 0" },
                  },
                }
              : {}),
            transition: transitionDuration != null ? `transform ${transitionDuration}ms` : undefined,
          },
        }}
      />
      {label && (
        <Typography
          variant="caption"
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 600,
            fontSize: "0.7rem",
            color: "common.white",
            pointerEvents: "none",
          }}
        >
          {label}
        </Typography>
      )}
    </Box>
  );
}
