import * as React from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import type { UITimelineProps, UITimelineItemProps } from "../types";

type TimelineContextValue = {
  active?: number;
  bulletSize?: number | string;
  color?: string;
  lineWidth?: number;
  reverseActive?: boolean;
  align?: string;
  itemCount: number;
};

const TimelineContext = React.createContext<TimelineContextValue>({ itemCount: 0 });

export function Timeline({
  active,
  bulletSize,
  color,
  align,
  lineWidth,
  reverseActive,
  children,
  className,
  style,
  "data-testid": testId,
  ...rest
}: UITimelineProps) {
  const count = React.Children.count(children);
  const ctx: TimelineContextValue = { active, bulletSize: bulletSize as any, color: color as any, lineWidth, reverseActive, align, itemCount: count };
  return (
    <TimelineContext.Provider value={ctx}>
      <Stack
        className={className}
        style={style}
        data-testid={testId}
        spacing={0}
        sx={{ position: "relative", alignItems: align === "right" ? "flex-end" : "flex-start" }}
        {...(rest as any)}
      >
        {children}
      </Stack>
    </TimelineContext.Provider>
  );
}

export function TimelineItem({
  title,
  bullet,
  color: itemColor,
  lineVariant,
  active: itemActive,
  children,
  className,
  style,
  "data-testid": testId,
  ...rest
}: UITimelineItemProps) {
  const ctx = React.useContext(TimelineContext);
  // Determine active state: if parent active index is defined, compute per-item
  // We need index: simplest is to rely on caller active but we don't have index here; use itemActive if provided
  const isActive = itemActive ?? false;
  const bulletSize = 20;
  const lineW = ctx.lineWidth ?? 2;
  const bulletBg = (itemColor as string) ?? (ctx.color as string) ?? "primary.main";
  const isRight = ctx.align === "right";

  const borderStyle = lineVariant === "dashed" ? "dashed" : lineVariant === "dotted" ? "dotted" : "solid";

  return (
    <Box
      className={className}
      style={style}
      data-testid={testId}
      sx={{
        display: "flex",
        flexDirection: isRight ? "row-reverse" : "row",
        gap: 1.5,
        position: "relative",
        minHeight: 56,
        textAlign: isRight ? "right" : "left",
      }}
      {...(rest as any)}
    >
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", width: bulletSize, flexShrink: 0 }}>
        <Box
          sx={{
            width: typeof bulletSize === "number" ? `${bulletSize}px` : bulletSize ?? 16,
            height: typeof bulletSize === "number" ? `${bulletSize}px` : bulletSize ?? 16,
            borderRadius: "50%",
            bgcolor: bullet ? "background.paper" : bulletBg,
            border: bullet ? `2px solid ${bulletBg}` : `2px solid ${bulletBg}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            color: bullet ? bulletBg : "#fff",
            flexShrink: 0,
            zIndex: 1,
            opacity: isActive ? 1 : 1,
          }}
        >
          {bullet}
        </Box>
        <Box
          sx={{
            flex: 1,
            width: `${lineW}px`,
            bgcolor: "divider",
            borderLeft: lineVariant && lineVariant !== "solid" ? `${lineW}px ${borderStyle} #e0e0e0` : undefined,
            backgroundColor: lineVariant === "solid" || !lineVariant ? "divider" : "transparent",
            mt: 0.5,
            minHeight: 16,
          }}
        />
      </Box>
      <Box sx={{ flex: 1, pb: 2, display: "flex", flexDirection: "column", alignItems: isRight ? "flex-end" : "flex-start" }}>
        {title ? <Box sx={{ fontWeight: 600, fontSize: 14, mb: 0.25 }}>{title}</Box> : null}
        <Box sx={{ fontSize: 13, color: "text.secondary" }}>{children}</Box>
      </Box>
    </Box>
  );
}

Timeline.Item = TimelineItem;
