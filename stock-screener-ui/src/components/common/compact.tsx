import type { ReactNode, CSSProperties } from "react";
import MuiCardContent from "@mui/material/CardContent";
import Card from "@mui/material/Card";
import MuiPaper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import SimpleGrid from "@mui/material/Grid";
import { Text, Title } from "@/ui";
import type { UIStackProps, UIPaperProps } from "@/ui";

const SCROLLABLE_PANEL_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
};

const SCROLL_CONTAINER_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "auto",
};

interface CompactPageProps extends UIStackProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export function CompactPage({
  title,
  description,
  actions,
  children,
  ...stackProps
}: CompactPageProps) {
  return (
    <Stack spacing={1} sx={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0, alignItems: "center", width: "100%" }} {...stackProps}>
      {(title || description || actions) && (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: 1 }}>
          <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
            {title ? (typeof title === "string" ? <Title order={2} size="h4">{title}</Title> : title) : null}
            {description ? <Text size="sm" c="dimmed">{description}</Text> : null}
          </Stack>
          {actions}
        </Box>
      )}
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", width: "100%", display: "flex", justifyContent: "center" }}>{children}</Box>
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
  const panelStyle: CSSProperties = scrollable ? { ...SCROLLABLE_PANEL_STYLE, ...style } : style;

  return (
    <MuiPaper elevation={1} sx={{ bgcolor: "background.paper", borderRadius: 1 }} style={panelStyle} data-testid={testId} {...(paperProps as any)}>
      <MuiCardContent sx={{ p: padded ? 1 : 0, "&:last-child": { pb: padded ? 1 : 0 } }}>
        {(title || description || action) && (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1, mb: 1, width: "100%" }}>
            <Stack spacing={1} sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
              {title ? (typeof title === "string" ? <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Title order={4} size="h5">{title}</Title></Box> : <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{title}</Box>) : null}
              {description ? <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Text size="sm" c="dimmed" data-testid="status">{description}</Text></Box> : null}
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
  return (
    <Card elevation={1} sx={{ bgcolor: "background.paper" }} {...(paperProps as any)}>
      <MuiCardContent sx={{ p: 1, "&:last-child": { pb: 1 }, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, textAlign: "center" }}>
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
  ...props
}: {
  children: ReactNode;
  [key: string]: any;
}) {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", width: "100%", p: 1 }}>
      <SimpleGrid container spacing={1} sx={{ justifyContent: "center", alignItems: "center", width: "100%", gap: 1 }} {...props}>
        {children}
      </SimpleGrid>
    </Box>
  );
}
