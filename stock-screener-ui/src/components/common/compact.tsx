import type { CSSProperties, ReactNode } from "react";
import { Box, Card, Paper, SimpleGrid, Stack, Text, Title, useDensity } from "@/ui";
import * as palette from "@/ui/palette";
import type { UIStackProps, UIPaperProps } from "@/ui";

const SCROLLABLE_PANEL_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflow: "hidden",
};

const SCROLL_CONTAINER_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflow: "auto",
};

interface CompactPageProps extends UIStackProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** Opt-in to the legacy centered layout. Default is left/stretch. */
  center?: boolean;
}

export function CompactPage({
  title,
  description,
  actions,
  children,
  center = false,
  ...stackProps
}: CompactPageProps) {
  return (
    <Stack
      spacing="sm"
      style={{
        alignItems: center ? "center" : "stretch",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minHeight: 0,
        width: "100%",
      }}
      className="flex flex-col w-full min-h-0 overflow-hidden"
      {...stackProps}
    >
      {(title || description || actions) && (
        <Box
          className="flex items-center justify-between w-full gap-2"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: 8 }}
        >
          <Stack spacing="sm" className="flex flex-start">
            {title ? (typeof title === "string" ? <Title order={2} size="h4">{title}</Title> : title) : null}
            {description ? <Text size="sm" c="dimmed">{description}</Text> : null}
          </Stack>
          {actions}
        </Box>
      )}
      <Box
        style={{ flex: 1, minHeight: 0, overflow: "auto", width: "100%", display: "flex", justifyContent: center ? "center" : "flex-start" }}
        className="flex-1 min-h-0 overflow-auto w-full flex"
      >
        {children}
      </Box>
    </Stack>
  );
}

interface CompactPanelProps extends UIPaperProps {
  children: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  padded?: boolean;
  testId?: string;
  id?: string;
  scrollable?: boolean;
  /**
   * Edge-to-edge header divider: the header spans the panel width and the
   * body keeps `panelPad`, instead of the header sitting inside the card's
   * padding. Terminal/desk pages use this so panel headers line up with the
   * grid rather than being inset by 8px on each side.
   */
  flush?: boolean;
}

export function CompactPanel({
  children,
  title,
  description,
  action,
  padded = true,
  testId,
  style,
  scrollable = false,
  flush = false,
  ...paperProps
}: CompactPanelProps) {
  /** Fin-app body inset: 4px (dense desk default; was 6px). */
  const pad = padded ? 0.5 : 0;
  const panelStyle: CSSProperties = scrollable ? { ...SCROLLABLE_PANEL_STYLE, ...style } : style;
  const bodyStyle: CSSProperties = flush ? { padding: pad * 8 } : {};

  return (
    <Paper
      data-compact=""
      className="bg-fin-surface rounded-fin border border-fin-border"
      style={{ backgroundColor: palette.SURFACE, borderRadius: 8, border: `1px solid ${palette.BORDER}`, ...panelStyle }}
      data-testid={testId}
      {...(paperProps as Record<string, unknown>)}
    >
      <Box
        data-compact-card-content=""
        className="flex flex-col"
        style={{
          padding: flush ? 0 : pad * 8,
          ...(scrollable && { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }),
        }}
      >
        {(title || description || action) && (
          <Box
            data-compact-header=""
            className="flex items-center justify-between gap-0.5 px-4 py-1 mb-0 w-full border-b border-fin-border"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 4,
              paddingLeft: 8,
              paddingRight: 8,
              paddingBottom: 0,
              width: "100%",
              borderBottom: `1px solid ${palette.BORDER}`,
            }}
          >
            <Stack spacing={0.5} className="flex flex-start min-w-0">
              {title ? (
                typeof title === "string" ? (
                  <Box className="flex items-center flex-start">
                    <Title order={4} size="sm" style={{ lineHeight: 1.2 }}>{title}</Title>
                  </Box>
                ) : (
                  <Box className="flex items-center flex-start">{title}</Box>
                )
              ) : null}
              {description ? (
                <Box className="flex items-center flex-start">
                  <Text size="sm" c="dimmed" data-testid="status">
                    {description}
                  </Text>
                </Box>
              ) : null}
            </Stack>
            {action ? <Box className="flex items-center justify-center">{action}</Box> : null}
          </Box>
        )}
        {scrollable ? (
          <Box style={{ ...SCROLL_CONTAINER_STYLE, ...bodyStyle }}>
            {children}
          </Box>
        ) : flush ? (
          <Box style={bodyStyle}>{children}</Box>
        ) : (
          children
        )}
      </Box>
    </Paper>
  );
}

interface CompactStatProps extends UIPaperProps {
  label: ReactNode;
  value: ReactNode;
  tone?: string;
  hint?: ReactNode;
  labelSize?: "xs" | "sm" | "md" | "lg" | "xl";
  valueSize?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Dense mode: smaller label/value fonts + tighter padding (report pages). */
  dense?: boolean;
}

export function CompactStat({
  label,
  value,
  tone = "text.primary",
  hint,
  labelSize = "xs",
  valueSize = "lg",
  dense = false,
  ...paperProps
}: CompactStatProps) {
  const { tokens: densityTokens } = useDensity();
  // 4px body inset keeps stat cards from adding vertical air between rows.
  const pad = dense ? 0.375 : Math.min(densityTokens.statPad, 0.5);
  const resolvedLabelSize = dense ? ("xs" as const) : labelSize;
  const resolvedValueSize = dense ? ("sm" as const) : valueSize;
  const padPx = pad * 8;
  return (
    <Card
      data-compact-stat=""
      className="bg-fin-surface border border-fin-border"
      style={{ backgroundColor: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}
      {...(paperProps as Record<string, unknown>)}
    >
      <Box
        className="flex flex-col items-center justify-center text-center gap-1"
        style={{
          padding: padPx,
          paddingBottom: padPx,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          textAlign: "center",
        }}
      >
        <Box className="flex items-center justify-center w-full">
          <Text size={resolvedLabelSize} tt="uppercase" fw={700} c="dimmed" style={{ lineHeight: 1.1, textAlign: "center" }}>
            {label}
          </Text>
        </Box>
        <Box className="flex items-center justify-center w-full">
          <Text size={resolvedValueSize} fw={700} c={tone} style={{ lineHeight: 1.1, textAlign: "center" }}>
            {value}
          </Text>
        </Box>
        {hint ? (
          typeof hint === "string" || typeof hint === "number" ? (
            <Box className="flex items-center justify-center w-full">
              <Text size="xs" c="dimmed" style={{ textAlign: "center" }}>
                {hint}
              </Text>
            </Box>
          ) : (
            <Box className="flex items-center justify-center w-full" style={{ marginTop: 4 }}>
              {hint}
            </Box>
          )
        ) : null}
      </Box>
    </Card>
  );
}

export function CompactStatGrid({
  children,
  center = false,
  ...props
}: {
  children: ReactNode;
  /** Opt-in to the legacy centered layout. Default is left/stretch. */
  center?: boolean;
  [key: string]: any;
}) {
  return (
    <Box
      style={{
        justifyContent: center ? "center" : "flex-start",
        alignItems: center ? "center" : "stretch",
        display: "flex",
        width: "100%",
        padding: 4,
      }}
      className="flex w-full p-2"
    >
      <SimpleGrid
        className="w-full gap-2"
        style={{
          justifyContent: center ? "center" : "flex-start",
          alignItems: center ? "center" : "stretch",
          width: "100%",
          gap: 4,
        }}
        {...props}
      >
        {children}
      </SimpleGrid>
    </Box>
  );
}
