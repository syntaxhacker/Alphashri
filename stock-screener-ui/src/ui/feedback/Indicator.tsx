import MuiBadge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import type { UIIndicatorProps } from "../types";

function mapColor(color: UIIndicatorProps["color"]): "primary" | "secondary" | "success" | "error" | "warning" | "info" | "default" {
  if (!color) return "primary";
  switch (color) {
    case "teal":
    case "green":
    case "success":
      return "success";
    case "red":
    case "danger":
      return "error";
    case "orange":
    case "yellow":
    case "warning":
      return "warning";
    case "cyan":
    case "violet":
    case "blue":
    case "pink":
      return "info";
    case "gray":
    case "dark":
      return "secondary";
    default:
      return "primary";
  }
}

function mapAnchor(position: UIIndicatorProps["position"]): { vertical: "top" | "bottom"; horizontal: "left" | "right" } {
  switch (position) {
    case "top-start":
      return { vertical: "top", horizontal: "left" };
    case "bottom-start":
      return { vertical: "bottom", horizontal: "left" };
    case "bottom-end":
      return { vertical: "bottom", horizontal: "right" };
    case "top-end":
    default:
      return { vertical: "top", horizontal: "right" };
  }
}

export function Indicator({
  label,
  color,
  size,
  offset,
  disabled,
  processing,
  position,
  children,
  className,
  style,
  "data-testid": testId,
  id,
  ...rest
}: UIIndicatorProps) {
  if (disabled) return <>{children}</>;

  const muiColor = mapColor(color);
  const anchor = mapAnchor(position);

  return (
    <MuiBadge
      badgeContent={label}
      color={muiColor as never}
      invisible={disabled}
      overlap="circular"
      anchorOrigin={anchor}
      className={className}
      style={style}
      id={id}
      data-testid={testId}
      sx={{
        "& .MuiBadge-badge": {
          ...(size != null ? { minWidth: size, height: size, fontSize: size * 0.5 } : {}),
          ...(offset != null ? { transform: `translate(${offset}px, -${offset}px)` } : {}),
          ...(processing
            ? {
                "&::after": {
                  content: '""',
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  border: 1,
                  borderColor: "inherit",
                  animation: "mui-indicator-ping 1.2s cubic-bezier(0,0,0.2,1) infinite",
                },
                "@keyframes mui-indicator-ping": {
                  "75%, 100%": { transform: "scale(1.8)", opacity: 0 },
                },
              }
            : {}),
        },
      }}
      {...(rest as Record<string, unknown>)}
    >
      <Box component="span" sx={{ display: "inline-flex" }}>
        {children}
      </Box>
    </MuiBadge>
  );
}
