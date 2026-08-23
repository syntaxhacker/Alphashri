import * as React from "react";
import MuiTooltip from "@mui/material/Tooltip";
import type { UITooltipProps } from "../types";

const placementMap: Record<string, any> = {
  top: "top",
  bottom: "bottom",
  left: "left",
  right: "right",
  "top-start": "top-start",
  "top-end": "top-end",
  "bottom-start": "bottom-start",
  "bottom-end": "bottom-end",
};

export function Tooltip({
  label,
  withArrow,
  position,
  openDelay,
  closeDelay,
  disabled,
  multiline,
  color,
  children,
  className,
  style,
  "data-testid": testId,
  ...rest
}: UITooltipProps) {
  if (disabled) return <>{children}</>;

  const placement = position ? placementMap[position] ?? "top" : "top";

  // MUI uses enterDelay/leaveDelay (ms) and enterNextDelay
  // openDelay -> enterDelay, closeDelay -> leaveDelay
  return (
    <MuiTooltip
      title={label as any}
      arrow={!!withArrow}
      placement={placement}
      enterDelay={openDelay}
      enterNextDelay={openDelay}
      leaveDelay={closeDelay}
      className={className}
      style={style}
      data-testid={testId}
      slotProps={{
        tooltip: {
          sx: {
            ...(multiline ? { maxWidth: 220, whiteSpace: "normal" } : {}),
            ...(color
              ? {
                  bgcolor: color as string,
                  color: "#fff",
                  "& .MuiTooltip-arrow": { color: color as string },
                }
              : {}),
            ...(style as any),
          },
        } as any,
        arrow: color
          ? { sx: { color: color as string } }
          : undefined,
      }}
      {...(rest as any)}
    >
      {/* MUI requires a single element child that can hold ref; wrap in span if needed */}
      <span
        style={{ display: "inline-flex" }}
        className={className}
        data-testid={testId ? `${testId}-wrapper` : undefined}
      >
        {children as any}
      </span>
    </MuiTooltip>
  );
}

// Preserve static members for compatibility (no-ops / wrappers)
(Tooltip as any).Group = ({ children }: any) => <>{children}</>;
(Tooltip as any).Floating = Tooltip;
