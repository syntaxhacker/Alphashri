import type { Meta } from "@storybook/html-vite";
import { createComponent, createMemo } from "solid-js";
import type { JSX } from "solid-js";
import { Box, Divider, Stack, Text, useMediaQuery } from "@/ui";
import * as palette from "@/ui/palette";

/**
 * Storybook's html renderer types `component` as a function returning a DOM
 * node; Solid's JSX.Element also admits null/number. The cast keeps the real
 * primitive in meta.component without inventing a wrapper component.
 */
export const asStoryComponent = (component: (props: any) => unknown) =>
  component as unknown as Meta["component"];

/**
 * Every colour below is a theme CSS variable, so the catalog follows the
 * running light/dark theme instead of pinning a second palette.
 * Helpers use createComponent rather than JSX because this file stays `.ts`.
 */
export const C = {
  bg: "var(--color-fin-bg)",
  surface: "var(--color-fin-surface)",
  alt: "var(--color-fin-surface-alt)",
  border: "var(--color-fin-border)",
  text: "var(--color-fin-text)",
  muted: "var(--color-fin-text-muted)",
  primary: "var(--color-fin-primary)",
  info: "var(--color-fin-info)",
  positive: "var(--color-fin-positive)",
  negative: "var(--color-fin-negative)",
  warning: "var(--color-fin-warning)",
} as const;

export const MONO = palette.MONO;

/** Shared canvas used by every layout story. */
export const Page = (props: { children: JSX.Element }) =>
  createComponent(Stack, {
    gap: "xl",
    style: { width: "100%", "max-width": "960px" },
    get children() {
      return props.children;
    },
  });

export const Note = (props: { children: JSX.Element }) =>
  createComponent(Text, {
    size: "xs",
    c: "dimmed",
    fs: MONO,
    style: { "line-height": "1.5" },
    get children() {
      return props.children;
    },
  });

export const Section = (props: { title: string; caption?: string; children: JSX.Element }) =>
  createComponent(Box, {
    component: "section",
    style: { width: "100%" },
    get children() {
      return [
        createComponent(Stack, {
          gap: "xs",
          style: { "margin-bottom": "8px" },
          children: [
            createComponent(Text, {
              size: "xs",
              fw: 700,
              tt: "uppercase",
              c: C.primary,
              fs: MONO,
              children: props.title,
            }),
            props.caption
              ? createComponent(Text, {
                  size: "xs",
                  c: "dimmed",
                  fs: MONO,
                  style: { "line-height": "1.5" },
                  children: props.caption,
                })
              : null,
          ],
        }),
        createComponent(Divider, { style: { "margin-bottom": "12px" } }),
        props.children,
      ];
    },
  });

export const Demo = (props: { label: string; children: JSX.Element }) =>
  createComponent(Stack, {
    gap: "xs",
    children: [
      createComponent(Note, { children: props.label }),
      props.children,
    ],
  });

/** A bordered, labelled tile standing in for real content inside a layout. */
export const Tile = (props: {
  label: string;
  sub?: string;
  tone?: string;
  w?: number | string;
  h?: number | string;
  grow?: number | string;
}) =>
  createComponent(Box, {
    p: "sm",
    style: {
      display: "flex",
      "flex-direction": "column",
      "justify-content": "center",
      gap: "2px",
      "min-width": "0",
      overflow: "hidden",
      border: `1px solid ${props.tone ?? C.border}`,
      "border-radius": "4px",
      background: C.alt,
      ...(props.w != null ? { width: typeof props.w === "number" ? `${props.w}px` : props.w } : {}),
      ...(props.h != null ? { height: typeof props.h === "number" ? `${props.h}px` : props.h } : {}),
      ...(props.grow != null ? { flex: String(props.grow) } : {}),
    },
    children: [
      createComponent(Text, { size: "sm", fw: 600, fs: MONO, truncate: true, children: props.label }),
      props.sub
        ? createComponent(Text, { size: "xs", c: "dimmed", fs: MONO, truncate: true, children: props.sub })
        : null,
    ],
  });

/** Dashed frame for a demo whose outer box is itself part of what is shown. */
export const Frame = (props: { children: JSX.Element; label?: string }) =>
  createComponent(Box, {
    p: "sm",
    style: { border: `1px dashed ${C.border}`, "border-radius": "4px", background: C.surface },
    children: [
      props.label ? createComponent(Note, { children: props.label }) : null,
      createComponent(Box, {
        style: { "margin-top": props.label ? "8px" : "0" },
        get children() {
          return props.children;
        },
      }),
    ],
  });

const select = (description: string, options: readonly (string | number)[], category: string) => ({
  control: { type: "select" as const },
  options,
  description,
  table: { category },
});
const number = (description: string, category: string) => ({
  control: { type: "number" as const },
  description,
  table: { category },
});
const text = (description: string, category: string) => ({
  control: { type: "text" as const },
  description,
  table: { category },
});
const boolean = (description: string, category: string) => ({
  control: { type: "boolean" as const },
  description,
  table: { category },
});
const disabled = (description: string, category: string) => ({
  control: false as const,
  description,
  table: { category },
});

/** Controls mirror the real prop types in src/ui/types.ts — no invented props. */
export const arg = {
  spacing: select("8pt token (xs/sm/md/lg/xl), a number in px, or raw CSS", ["xs", "sm", "md", "lg", "xl", 4, 8, 16, 24, 32], "Spacing"),
  padding: select("Padding: 8pt token, number in px, or raw CSS", ["xs", "sm", "md", "lg", "xl", 4, 8, 16, 24, 32], "Spacing"),
  gap: select("Gap: 8pt token, number in px, or raw CSS", ["xs", "sm", "md", "lg", "xl", 4, 8, 16, 24, 32], "Spacing"),
  gapNumber: number("Gap in px (numeric props only)", "Spacing"),
  direction: select("flex-direction", ["row", "column", "row-reverse", "column-reverse"], "Layout"),
  wrapFlex: select("flex-wrap", ["wrap", "nowrap", "wrap-reverse"], "Layout"),
  wrapBool: boolean("Allow wrapping (ToolbarRow / Row)", "Layout"),
  justifyFlex: select("justify-content", ["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"], "Alignment"),
  justifyRow: select("justify-content (Row tokens)", ["start", "center", "end", "between", "around", "evenly"], "Alignment"),
  justifyToolbar: select("justify-content (ToolbarRow subset)", ["flex-start", "center", "flex-end", "space-between"], "Alignment"),
  alignFlex: select("align-items", ["flex-start", "center", "flex-end", "stretch", "baseline"], "Alignment"),
  alignRow: select("align-items (Row tokens)", ["start", "center", "end", "stretch", "baseline"], "Alignment"),
  alignCol: select("align-self (Col tokens)", ["start", "center", "end", "stretch"], "Alignment"),
  radius: select("border-radius token: Paper xs2/sm4/md6/lg10/xl14, Card xs4/sm8/md16/lg24/xl32", ["xs", "sm", "md", "lg", "xl"], "Surface"),
  shadow: select("Named Tailwind shadow step, or a raw CSS value", ["xs", "sm", "md", "lg", "xl"], "Surface"),
  bg: select("Background: theme CSS variable or colour token", ["var(--color-fin-bg)", "var(--color-fin-surface)", "var(--color-fin-surface-alt)"], "Surface"),
  color: text("Text colour (theme CSS variable or colour token)", "Surface"),
  cols: number("Number of equal tracks", "Grid"),
  span: select("GridCol span: numeric columns, auto, or content", [1, 2, 3, 4, 6, 8, 12, "auto", "content"], "Grid"),
  offset: number("GridCol offset: grid-column-start = offset + 1", "Grid"),
  order: number("Visual order without changing DOM order", "Grid"),
  height: select("Viewport height: number in px or raw CSS", [96, 128, 168, 240, "100%"], "Sizing"),
  width: select("Viewport width: number in px or raw CSS", [240, 320, 420, "100%"], "Sizing"),
  orientation: select("Divider orientation", ["horizontal", "vertical"], "Content"),
  labelPosition: select("labelPosition is accepted for API compatibility", ["left", "center", "right"], "Content"),
  bool: boolean("Boolean prop", "State"),
  in: boolean("in: expanded when true", "State"),
  duration: number("transitionDuration in ms", "State"),
  timing: text("transitionTimingFunction", "State"),
  component: select("Rendered semantic tag (limited intrinsic registry)", ["div", "section", "article", "aside", "header", "footer", "main"], "Content"),
  selectPos: select("CSS position", ["static", "relative", "absolute", "fixed", "sticky"], "Layout"),
  textFlex: text("CSS flex shorthand", "Sizing"),
  inline: boolean("inline: inline-flex instead of flex", "Layout"),
  legacy: disabled("Legacy Mantine-compat prop: accepted but swallowed by the primitive", "Compatibility"),
};

export const GAP_TOKENS = ["xs", "sm", "md", "lg", "xl"] as const;
export const RADIUS_TOKENS = ["xs", "sm", "md", "lg", "xl"] as const;
export const SHADOW_STEPS = ["xs", "sm", "md", "lg", "xl"] as const;
export const PAPER_RADIUS_PX = ["2px", "4px", "6px", "10px", "14px"] as const;
export const CARD_RADIUS_PX = ["4px", "8px", "16px", "24px", "32px"] as const;

/** Live viewport readout — useMediaQuery is a real Solid signal-backed hook. */
export const ResponsiveReadout = () => {
  const sm = useMediaQuery("(min-width: 640px)");
  const md = useMediaQuery("(min-width: 768px)");
  const lg = useMediaQuery("(min-width: 1024px)");
  const active = createMemo(() => (lg() ? "lg (≥1024)" : md() ? "md (≥768)" : sm() ? "sm (≥640)" : "base (<640)"));
  return createComponent(Note, {
    get children() {
      return `active breakpoint: ${active()}`;
    },
  });
};

/** Small, stable sample rows used by scroll/overflow demos. */
export const ROWS = [
  "RELIANCE", "HDFCBANK", "TCS", "INFY", "SBIN", "MARUTI",
  "ICICIBANK", "KOTAKBANK", "LT", "AXISBANK", "BAJFINANCE", "WIPRO",
] as const;

export const UNIVERSE_OPTIONS: { value: string; label: string }[] = [
  { value: "nifty50", label: "NIFTY 50" },
  { value: "nifty500", label: "NIFTY 500" },
  { value: "banknifty", label: "BANKNIFTY" },
];

export const TIMEFRAME_OPTIONS: { value: string; label: string }[] = [
  { value: "5m", label: "5 min" },
  { value: "15m", label: "15 min" },
  { value: "1h", label: "1 hour" },
];
