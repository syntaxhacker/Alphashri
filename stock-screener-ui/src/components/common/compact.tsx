import type { CSSProperties, JSX } from "solid-js";
import { Show, splitProps } from "solid-js";
import { Box, Card, Paper, SimpleGrid, Stack, Text, Title, useDensity } from "@/ui";
import * as palette from "@/ui/palette";
import type { UIStackProps, UIPaperProps } from "@/ui";

const SCROLLABLE_PANEL_STYLE: CSSProperties = {
  display: "flex",
  "flex-direction": "column",
  flex: 1,
  "min-height": "0px",
  "min-width": "0px",
  overflow: "hidden",
};

const SCROLL_CONTAINER_STYLE: CSSProperties = {
  flex: 1,
  "min-height": "0px",
  "min-width": "0px",
  overflow: "auto",
};

interface CompactPageProps extends UIStackProps {
  title?: JSX.Element;
  description?: JSX.Element;
  actions?: JSX.Element;
  children: JSX.Element;
  /** Opt-in to the legacy centered layout. Default is left/stretch. */
  center?: boolean;
}

export function CompactPage(props: CompactPageProps) {
  const [own, stackProps] = splitProps(props, ["title", "description", "actions", "children", "center"]);
  const center = () => own.center ?? false;
  const hasHeader = () => own.title != null || own.description != null || own.actions != null;
  const isStringTitle = () => typeof own.title === "string" || typeof own.title === "number";

  return (
    <Stack
      spacing="sm"
      style={{
        "align-items": center() ? "center" : "stretch",
        height: "100%",
        display: "flex",
        "flex-direction": "column",
        overflow: "hidden",
        "min-height": "0px",
        width: "100%",
      }}
      className="flex flex-col w-full min-h-0 overflow-hidden"
      {...stackProps}
    >
      <Show when={hasHeader()}>
        <Box
          className="flex items-center justify-between w-full gap-2"
          style={{ display: "flex", "align-items": "center", "justify-content": "space-between", width: "100%", gap: "8px" }}
        >
          <Stack spacing="sm" className="flex flex-start">
            <Show when={own.title}>
              <Show when={isStringTitle()} fallback={<Box className="flex items-center flex-start">{own.title}</Box>}>
                <Title order={2} size="h4">{own.title}</Title>
              </Show>
            </Show>
            <Show when={own.description}>
              <Text size="sm" c="dimmed">{own.description}</Text>
            </Show>
          </Stack>
          {own.actions}
        </Box>
      </Show>
      <Box
        style={{ flex: 1, "min-height": "0px", overflow: "auto", width: "100%", display: "flex", "justify-content": center() ? "center" : "flex-start" }}
        className="flex-1 min-h-0 overflow-auto w-full flex"
      >
        {own.children}
      </Box>
    </Stack>
  );
}

interface CompactPanelProps extends UIPaperProps {
  children: JSX.Element;
  title?: JSX.Element;
  description?: JSX.Element;
  action?: JSX.Element;
  padded?: boolean;
  testId?: string;
  id?: string;
  scrollable?: boolean;
  /** Edge-to-edge header divider: the header spans the panel width and the
   *  body keeps `panelPad`, instead of the header sitting inside the card's
   *  padding. Terminal/desk pages use this so panel headers line up with the
   *  grid rather than being inset by 8px on each side. */
  flush?: boolean;
}

export function CompactPanel(props: CompactPanelProps) {
  const [own, paperProps] = splitProps(props, [
    "children",
    "title",
    "description",
    "action",
    "padded",
    "testId",
    "scrollable",
    "flush",
    "style",
  ]);
  const padded = () => own.padded ?? true;
  const flush = () => own.flush ?? false;
  const scrollable = () => own.scrollable ?? false;
  /** Fin-app body inset: 4px (dense desk default; was 6px). */
  const pad = () => (padded() ? 0.5 : 0);
  const panelStyle = (): CSSProperties =>
    scrollable() ? { ...SCROLLABLE_PANEL_STYLE, ...own.style } : (own.style ?? {});
  const bodyStyle = (): CSSProperties => (flush() ? { padding: `${pad() * 8}px` } : {});
  const hasHeader = () => own.title != null || own.description != null || own.action != null;
  const isStringTitle = () => typeof own.title === "string" || typeof own.title === "number";

  return (
    <Paper
      data-compact=""
      className="bg-fin-surface rounded-fin border border-fin-border"
      style={{ "background-color": palette.SURFACE, "border-radius": "2px", border: `1px solid ${palette.BORDER}`, ...panelStyle() }}
      data-testid={own.testId}
      {...(paperProps as Record<string, unknown>)}
    >
      <Box
        data-compact-card-content=""
        className="flex flex-col"
        style={{
          padding: flush() ? 0 : `${pad() * 8}px`,
          ...(scrollable() && { flex: 1, "min-height": "0px", display: "flex", "flex-direction": "column", overflow: "hidden" }),
        }}
      >
        <Show when={hasHeader()}>
          <Box
            data-compact-header=""
            className="flex items-center justify-between gap-0.5 px-4 py-1 mb-0 w-full border-b border-fin-border"
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "space-between",
              gap: "4px",
              "padding-left": "8px",
              "padding-right": "8px",
              "padding-bottom": "0px",
              width: "100%",
              "border-bottom": `1px solid ${palette.BORDER}`,
            }}
          >
            <Stack spacing={0.5} className="flex flex-start min-w-0">
              <Show when={own.title}>
                <Show when={isStringTitle()} fallback={<Box className="flex items-center flex-start">{own.title}</Box>}>
                  <Box className="flex items-center flex-start">
                    <Title
                      order={4}
                      style={{
                        "font-size": "10px",
                        "font-family": palette.MONO,
                        "font-weight": 700,
                        "letter-spacing": "0.08em",
                        "text-transform": "uppercase",
                        "line-height": "1.2",
                        color: palette.PRIMARY,
                      }}
                    >
                      {own.title}
                    </Title>
                  </Box>
                </Show>
              </Show>
              <Show when={own.description}>
                <Box className="flex items-center flex-start">
                  <Text size="sm" c="dimmed" data-testid="status">
                    {own.description}
                  </Text>
                </Box>
              </Show>
            </Stack>
            <Show when={own.action}>
              <Box className="flex items-center justify-center">{own.action}</Box>
            </Show>
          </Box>
        </Show>
        <Show when={scrollable()} fallback={
          <Show when={flush()} fallback={<>{own.children}</>}>
            <Box style={bodyStyle()}>{own.children}</Box>
          </Show>
        }>
          <Box style={{ ...SCROLL_CONTAINER_STYLE, ...bodyStyle() }}>
            {own.children}
          </Box>
        </Show>
      </Box>
    </Paper>
  );
}

interface CompactStatProps extends UIPaperProps {
  label: JSX.Element;
  value: JSX.Element;
  tone?: string;
  hint?: JSX.Element;
  labelSize?: "xs" | "sm" | "md" | "lg" | "xl";
  valueSize?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Dense mode: smaller label/value fonts + tighter padding (report pages). */
  dense?: boolean;
}

export function CompactStat(props: CompactStatProps) {
  const [own, paperProps] = splitProps(props, [
    "label",
    "value",
    "tone",
    "hint",
    "labelSize",
    "valueSize",
    "dense",
  ]);
  const tone = () => own.tone ?? "default";
  const dense = () => own.dense ?? false;
  const labelSize = (): "xs" | "sm" | "md" | "lg" | "xl" => (dense() ? "xs" : (own.labelSize ?? "xs"));
  const valueSize = (): "xs" | "sm" | "md" | "lg" | "xl" => (dense() ? "sm" : (own.valueSize ?? "lg"));
  const densityApi = useDensity();
  // 4px body inset keeps stat cards from adding vertical air between rows.
  const pad = () => (dense() ? 0.375 : Math.min(densityApi.tokens.statPad, 0.5));
  const padPx = () => `${pad() * 8}px`;

  const isPrimitiveHint = () => typeof own.hint === "string" || typeof own.hint === "number";

  return (
    <Card
      data-compact-stat=""
      className="bg-fin-surface border border-fin-border"
      style={{ "background-color": palette.SURFACE, border: `1px solid ${palette.BORDER}` }}
      {...(paperProps as Record<string, unknown>)}
    >
      <Box
        className="flex flex-col items-center justify-center text-center gap-1"
        style={{
          padding: padPx(),
          "padding-bottom": padPx(),
          display: "flex",
          "flex-direction": "column",
          "align-items": "center",
          "justify-content": "center",
          gap: "4px",
          "text-align": "center",
        }}
      >
        <Box className="flex items-center justify-center w-full">
          <Text size={labelSize()} tt="uppercase" fw={700} c="dimmed" style={{ "line-height": "1.15", "letter-spacing": "0.04em", "text-align": "center" }}>
            {own.label}
          </Text>
        </Box>
        <Box className="flex items-center justify-center w-full">
          <Text
            size={valueSize()}
            fw={700}
            c={tone()}
            style={{
              "line-height": "1.1",
              "font-family": palette.MONO,
              "font-variant-numeric": "tabular-nums",
              "text-align": "center",
            }}
          >
            {own.value}
          </Text>
        </Box>
        <Show when={own.hint != null}>
          <Show
            when={isPrimitiveHint()}
            fallback={<Box className="flex items-center justify-center w-full" style={{ "margin-top": "4px" }}>{own.hint}</Box>}
          >
            <Box className="flex items-center justify-center w-full">
              <Text size="xs" c="dimmed" style={{ "text-align": "center" }}>
                {own.hint}
              </Text>
            </Box>
          </Show>
        </Show>
      </Box>
    </Card>
  );
}

export function CompactStatGrid(props: {
  children: JSX.Element;
  /** Opt-in to the legacy centered layout. Default is left/stretch. */
  center?: boolean;
  [key: string]: any;
}) {
  const [own, rest] = splitProps(props, ["children", "center"]);
  const center = () => own.center ?? false;

  return (
    <Box
      style={{
        "justify-content": center() ? "center" : "flex-start",
        "align-items": center() ? "center" : "stretch",
        display: "flex",
        width: "100%",
        padding: "4px",
      }}
      className="flex w-full p-2"
    >
      <SimpleGrid
        className="w-full gap-2"
        style={{
          "justify-content": center() ? "center" : "flex-start",
          "align-items": center() ? "center" : "stretch",
          width: "100%",
          gap: "4px",
        }}
        {...rest}
      >
        {own.children}
      </SimpleGrid>
    </Box>
  );
}
