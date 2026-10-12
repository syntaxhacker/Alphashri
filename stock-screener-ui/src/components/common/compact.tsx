import type { ReactNode, CSSProperties } from "react";
import MuiCardContent from "@mui/material/CardContent";
import Card from "@mui/material/Card";
import MuiPaper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import SimpleGrid from "@mui/material/Grid";
import { Text, Title, useDensity } from "@/ui";
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
    <Stack spacing={1} style={{ alignItems: center ? "center" : "stretch" }} sx={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0, width: "100%" }} {...stackProps}>
      {(title || description || actions) && (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: 1 }}>
          <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
            {title ? (typeof title === "string" ? <Title order={2} size="h4">{title}</Title> : title) : null}
            {description ? <Text size="sm" c="dimmed">{description}</Text> : null}
          </Stack>
          {actions}
        </Box>
      )}
      <Box style={{ justifyContent: center ? "center" : "flex-start" }} sx={{ flex: 1, minHeight: 0, overflow: "auto", width: "100%", display: "flex" }}>{children}</Box>
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
  ...paperProps
}: CompactPanelProps) {
  const { tokens: densityTokens } = useDensity();
  const pad = padded ? densityTokens.panelPad : 0;
  const panelStyle: CSSProperties = scrollable ? { ...SCROLLABLE_PANEL_STYLE, ...style } : style;

    return (
      <MuiPaper elevation={0} sx={{ bgcolor: palette.SURFACE, borderRadius: 1, border: `1px solid ${palette.BORDER}` }} style={panelStyle} data-testid={testId} {...(paperProps as any)}>
        <MuiCardContent sx={{ p: pad, "&:last-child": { pb: pad }, ...(scrollable && { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }) }}>
        {(title || description || action) && (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1, mb: 1, width: "100%", borderBottom: `1px solid ${palette.BORDER}` }}>
            <Stack spacing={1} sx={{ display: "flex", alignItems: "flex-start", justifyContent: "flex-start", gap: 1, minWidth: 0 }}>
              {title ? (typeof title === "string" ? <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start" }}><Title order={4} size="h5">{title}</Title></Box> : <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start" }}>{title}</Box>) : null}
              {description ? <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start" }}><Text size="sm" c="dimmed" data-testid="status">{description}</Text></Box> : null}
            </Stack>
            {action ? <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{action}</Box> : null}
          </Box>
        )}
        {scrollable ? <Box sx={SCROLL_CONTAINER_STYLE}>{children}</Box> : children}
      </MuiCardContent>
    </MuiPaper>
  );
}

interface CompactStatProps extends UIPaperProps {
  label: ReactNode;
  value: ReactNode;
  tone?: string;
  hint?: ReactNode;
  labelSize?: "xs" | "sm" | "md" | "lg" | "xl";
  valueSize?: "xs" | "sm" | "md" | "lg" | "xl";
}

export function CompactStat({
  label,
  value,
  tone = "text.primary",
  hint,
  labelSize = "xs",
  valueSize = "lg",
  ...paperProps
}: CompactStatProps) {
  const { tokens: densityTokens } = useDensity();
  return (
    <Card elevation={0} sx={{ bgcolor: palette.SURFACE, border: `1px solid ${palette.BORDER}` }} {...(paperProps as any)}>
      <MuiCardContent sx={{ p: densityTokens.statPad, "&:last-child": { pb: densityTokens.statPad }, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, textAlign: "center" }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
          <Text size={labelSize} tt="uppercase" fw={700} c="dimmed" lh={1.1} ta="center">
            {label}
          </Text>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
          <Text size={valueSize} fw={700} c={tone} lh={1.1} ta="center">
            {value}
          </Text>
        </Box>
        {hint ? (
          typeof hint === "string" || typeof hint === "number" ? (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
              <Text size="xs" c="dimmed" ta="center">
                {hint}
              </Text>
            </Box>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", mt: 0.5 }}>{hint}</Box>
          )
        ) : null}
      </MuiCardContent>
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
    <Box style={{ justifyContent: center ? "center" : "flex-start", alignItems: center ? "center" : "stretch" }} sx={{ display: "flex", width: "100%", p: 1 }}>
      <SimpleGrid container spacing={1} style={{ justifyContent: center ? "center" : "flex-start", alignItems: center ? "center" : "stretch" }} sx={{ width: "100%", gap: 1 }} {...props}>
        {children}
      </SimpleGrid>
    </Box>
  );
}
