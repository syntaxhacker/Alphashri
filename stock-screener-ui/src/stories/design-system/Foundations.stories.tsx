import type { Meta, StoryObj } from "@storybook/html-vite";
import type { JSX } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Card, Divider, Flex, Paper, Stack, Text, Title } from "@/ui";
import { DENSITY_TOKENS } from "@/ui";
import { sp } from "@/ui/layout/spacing";
import * as palette from "@/ui/palette";

const meta: Meta = {
  title: "Design System/Foundations",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The tokens and scales the terminal actually renders with. Names, values and uses below are read from palette.ts, spacing.ts, Paper/Card and density.tsx at render time — this file defines no colours of its own.",
      },
    },
  },
};
export default meta;

type Story = StoryObj;

/** Every value here is read from a token at render time; no literal colour is authored in this file. */
const Swatch = (props: {
  name: string;
  value: string;
  use: string;
  fill: string;
  ink?: string;
  border?: string;
}) => (
  <Flex
    gap="sm"
    align="center"
    style={{ padding: "6px 8px", "border-bottom": "1px solid var(--color-fin-border)" }}
  >
    <div
      style={{
        width: "112px",
        height: "30px",
        "flex-shrink": 0,
        "border-radius": "4px",
        background: props.fill,
        border: `1px solid ${props.border ?? "var(--color-fin-border)"}`,
        color: props.ink ?? palette.TEXT,
        display: "grid",
        "place-items": "center",
        "font-family": palette.MONO,
        "font-size": "10px",
      }}
    >
      {props.name}
    </div>
    <div style={{ "min-width": 0, flex: 1 }}>
      <Text size="xs" c="default" style={{ "font-family": palette.MONO }}>{props.value}</Text>
      <Text size="xs" c="dimmed">{props.use}</Text>
    </div>
  </Flex>
);

const Section = (props: { title: string; note?: string; children: JSX.Element }) => (
  <Paper p="md" radius="md" style={{ border: "1px solid var(--color-fin-border)" }}>
    <Stack gap="sm">
      <Title order={3} size="md">{props.title}</Title>
      {props.note ? <Text size="xs" c="dimmed">{props.note}</Text> : null}
      {props.children}
    </Stack>
  </Paper>
);

const anchors = [
  { name: "PRIMARY", value: palette.PRIMARY, use: "Amber chrome: panel headers, active tabs, selection, keys", ink: palette.BG },
  { name: "POSITIVE_COLOR", value: palette.POSITIVE_COLOR, use: "Bullish up-ticks, positive deltas, TP markers", ink: palette.BG },
  { name: "NEGATIVE_COLOR", value: palette.NEGATIVE_COLOR, use: "Bearish down-ticks, negative deltas, SL markers", ink: palette.BG },
  { name: "TEXT_COLOR", value: palette.TEXT_COLOR, use: "Primary ink on dark surfaces", ink: palette.BG },
  { name: "TEXT_MUTED_COLOR", value: palette.TEXT_MUTED_COLOR, use: "Secondary ink, labels, strong edges", ink: palette.BG },
  { name: "BG_COLOR", value: palette.BG_COLOR, use: "Page and chart canvas", ink: palette.TEXT },
  { name: "SURFACE_COLOR", value: palette.SURFACE_COLOR, use: "Panels and cards", ink: palette.TEXT },
  { name: "SURFACE_ALT_COLOR", value: palette.SURFACE_ALT_COLOR, use: "Raised step: popovers, headers, active rows", ink: palette.TEXT },
  { name: "BORDER_COLOR", value: palette.BORDER_COLOR, use: "Canonical hairline between surfaces", ink: palette.TEXT },
];

const tones = [
  { name: "POSITIVE", value: palette.POSITIVE, use: "Gains, bullish state, support levels" },
  { name: "NEGATIVE", value: palette.NEGATIVE, use: "Losses, bearish state, resistance levels" },
  { name: "NEUTRAL", value: palette.NEUTRAL, use: "Flat / muted state" },
  { name: "WARNING", value: palette.WARNING, use: "Caution, EOD exits, max pain" },
  { name: "INFO", value: palette.INFO, use: "Links, informational ink, CE / call OI leg" },
  { name: "ERROR", value: palette.ERROR, use: "Alias of NEGATIVE — error states" },
];

const borders = [
  { name: "BORDER_SUBTLE", value: palette.BORDER_SUBTLE, use: "Faint dividers (BORDER_COLOR at 0.6 alpha)" },
  { name: "BORDER_DEFAULT", value: palette.BORDER_DEFAULT, use: "Canonical hairline (BORDER_COLOR)" },
  { name: "BORDER_STRONG", value: palette.BORDER_STRONG, use: "Emphasised edge (TEXT_MUTED at 0.6)" },
  { name: "BORDER_FOCUS", value: palette.BORDER_FOCUS, use: "Keyboard focus ring (PRIMARY at 0.9)" },
  { name: "BORDER_POSITIVE", value: palette.BORDER_POSITIVE, use: "Positive state outline" },
  { name: "BORDER_NEGATIVE", value: palette.BORDER_NEGATIVE, use: "Negative state outline" },
  { name: "BORDER_WARNING", value: palette.BORDER_WARNING, use: "Warning state outline" },
  { name: "BORDER_INFO", value: palette.BORDER_INFO, use: "Informational outline" },
  { name: "BORDER_DISABLED", value: palette.BORDER_DISABLED, use: "Disabled edge (TEXT_MUTED at 0.25)" },
];

export const ColorTokens: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "980px" }}>
        <Section
          title="Raw anchors"
          note="palette.ts is the single source of truth. Changing one anchor re-themes the whole UI; nothing in components is a literal colour."
        >
          <div>
            {anchors.map((a) => (
              <Swatch name={a.name} value={a.value} use={a.use} fill={a.value} ink={a.ink} />
            ))}
          </div>
        </Section>

        <Section
          title="Semantic tones"
          note="Named roles for state and direction. ERROR resolves to NEGATIVE; NEUTRAL reuses TEXT_MUTED_COLOR."
        >
          <div>
            {tones.map((t) => (
              <Swatch name={t.name} value={t.value} use={t.use} fill={t.value} ink={palette.BG} />
            ))}
          </div>
        </Section>

        <Section
          title="Surface ramp"
          note="page → panel → raised, each adjacent pair kept at least 1.15:1 apart, with the hairline that separates them."
        >
          <div
            style={{
              background: palette.SURFACES.page,
              padding: "12px",
              border: `1px solid ${palette.SURFACES.border}`,
            }}
          >
            <Text size="xs" c="dimmed">page / BG_COLOR</Text>
            <div style={{ background: palette.SURFACES.panel, padding: "12px", "margin-top": "8px" }}>
              <Text size="xs" c="default">panel / SURFACE_COLOR</Text>
              <div style={{ background: palette.SURFACES.raised, padding: "12px", "margin-top": "8px" }}>
                <Text size="xs" c="default" style={{ color: palette.SURFACE_TEXT }}>raised / SURFACE_ALT_COLOR</Text>
              </div>
            </div>
          </div>
          <div style={{ "margin-top": "8px" }}>
            <Swatch name="page" value={palette.SURFACES.page} use="Canvas" fill={palette.SURFACES.page} ink={palette.TEXT} />
            <Swatch name="panel" value={palette.SURFACES.panel} use="Panels / cards" fill={palette.SURFACES.panel} ink={palette.TEXT} />
            <Swatch name="raised" value={palette.SURFACES.raised} use="Popovers / headers / active rows" fill={palette.SURFACES.raised} ink={palette.TEXT} />
            <Swatch name="border" value={palette.SURFACES.border} use="Hairline" fill={palette.SURFACES.panel} border={palette.SURFACES.border} ink={palette.TEXT} />
          </div>
        </Section>

        <Section
          title="Semantic borders"
          note="Derived from anchors through alpha(), so retuning an anchor re-themes every border. Mirrored as --color-fin-border-* in tailwind.css."
        >
          <div>
            {borders.map((b) => (
              <Swatch name={b.name} value={b.value} use={b.use} fill={palette.SURFACE_ALT} border={b.value} ink={palette.TEXT} />
            ))}
          </div>
        </Section>
      </Stack>
    )),
};

export const TypeScale: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "900px" }}>
        <Section
          title="Text sizes"
          note="Rendered with the real <Text> component. Text.tsx maps xs 0.75rem · sm 0.875rem · md 1rem · lg 1.125rem · xl 1.25rem."
        >
          {(["xs", "sm", "md", "lg", "xl"] as const).map((size) => (
            <Flex
             
              gap="md"
              align="baseline"
              style={{ "border-bottom": "1px solid var(--color-fin-border)", padding: "6px 0" }}
            >
              <Text size="xs" c="dimmed" className="font-mono" style={{ width: "72px" }}>{size}</Text>
              <Text size={size} fw={500}>Alphashri terminal 1,234.56</Text>
            </Flex>
          ))}
        </Section>

        <Section
          title="Title sizes and order"
          note="order selects the semantic element h1…h6; it does not set a font-size. Pass size to apply the Title scale (xl is 1.5rem here, unlike Text)."
        >
          <Stack gap="xs">
            {([1, 2, 3, 4, 5, 6] as const).map((order) => (
              <Title order={order} size="md">Order {order} — semantic h{order}</Title>
            ))}
          </Stack>
          <Divider label="Title size prop" labelPosition="left" />
          <Stack gap="xs">
            {(["sm", "md", "lg", "xl"] as const).map((size) => (
              <Title order={3} size={size}>size=&quot;{size}&quot;</Title>
            ))}
          </Stack>
        </Section>

        <Section
          title="Numeric / mono treatment"
          note={`Tabular figures are set globally; the MONO stack is ${palette.MONO}. Use the font-mono utility for price, P&L, OI and IV columns.`}
        >
          <Flex gap="lg" align="baseline" wrap="wrap">
            <Text size="sm" fw={500} className="font-mono">23,450.85</Text>
            <Text size="sm" c="success" className="font-mono">+1,240.50</Text>
            <Text size="sm" c="error" className="font-mono">-318.25</Text>
            <Text size="xs" c="dimmed" className="font-mono">IV 18.42%</Text>
          </Flex>
        </Section>
      </Stack>
    )),
};

export const SpacingScale: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "860px" }}>
        <Section
          title="Spacing (spacing.ts)"
          note="Only xs 4 · sm 8 · md 16 · lg 24 · xl 32 exist. The 8pt grid uses 16 outer / 8 inner; there are no 12 / 48 / 64 spacing tokens."
        >
          {(["xs", "sm", "md", "lg", "xl"] as const).map((step) => (
            <Flex gap="md" align="center" style={{ padding: "4px 0" }}>
              <Text size="xs" c="dimmed" className="font-mono" style={{ width: "72px" }}>{step}</Text>
              <div style={{ width: sp(step), height: "14px", background: palette.PRIMARY, "border-radius": "2px" }} />
              <Text size="xs" c="default" className="font-mono">{sp(step)}</Text>
            </Flex>
          ))}
        </Section>
        <Text size="xs" c="dimmed">
          Component padding and gaps take these names (p=&quot;md&quot;, gap=&quot;sm&quot;); a number is a literal px value, not a named token.
        </Text>
      </Stack>
    )),
};

export const RadiusElevationMotion: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "980px" }}>
        <Section
          title="Radius — Paper and Card"
          note="Two documented scales. Paper: xs 2 · sm 4 · md 6 · lg 10 · xl 14. Card: xs 4 · sm 8 · md 16 · lg 24 · xl 32. They are not interchangeable."
        >
          <Flex gap="sm" wrap="wrap">
            {(["xs", "sm", "md", "lg", "xl"] as const).map((r) => (
              <Paper radius={r} p="sm" style={{ width: "96px", border: `1px solid ${palette.BORDER}`, "text-align": "center" }}>
                <Text size="xs" c="dimmed" className="font-mono">Paper {r}</Text>
              </Paper>
            ))}
          </Flex>
          <Flex gap="sm" wrap="wrap" style={{ "margin-top": "8px" }}>
            {(["xs", "sm", "md", "lg", "xl"] as const).map((r) => (
              <Card radius={r} p="sm" style={{ width: "96px", border: `1px solid ${palette.BORDER}`, "text-align": "center" }}>
                <Text size="xs" c="dimmed" className="font-mono">Card {r}</Text>
              </Card>
            ))}
          </Flex>
          <Text size="xs" c="dimmed" style={{ "margin-top": "8px" }}>
            AGENTS.md guidance: 4 small · 6 controls (--radius-fin) · 10 large. Tailwind exposes --radius-sm 4px, --radius-md 6px, --radius-lg 10px.
          </Text>
        </Section>

        <Section
          title="Elevation / shadow"
          note="Paper's named steps map to Tailwind shadow utilities; a raw CSS value is painted inline. The app is flat — dialogs use one soft shadow."
        >
          <Flex gap="sm" wrap="wrap">
            {(["xs", "sm", "md", "lg", "xl"] as const).map((s) => (
              <Paper shadow={s} radius="md" p="md" style={{ width: "110px", border: `1px solid ${palette.BORDER}` }}>
                <Text size="xs" c="dimmed" className="font-mono">shadow {s}</Text>
              </Paper>
            ))}
          </Flex>
          <Paper shadow={palette.DIALOG_SHADOW} radius="md" p="md" style={{ "margin-top": "12px", border: `1px solid ${palette.BORDER}` }}>
            <Text size="xs" c="dimmed" className="font-mono">DIALOG_SHADOW = {palette.DIALOG_SHADOW}</Text>
          </Paper>
        </Section>

        <Section
          title="Motion"
          note="tailwind.css defines value-flash-up / value-flash-down (600ms ease-out) for changed numeric cells; prefers-reduced-motion disables both."
        >
          <div className="value-flash-up" style={{ background: palette.TINT_POSITIVE, padding: "10px", "border-left": `2px solid ${palette.POSITIVE}` }}>
            <Text size="sm" c="success" className="font-mono">+18.42 (0.08%)</Text>
          </div>
          <Text size="xs" c="dimmed">Under reduced-motion the flash is suppressed; the value itself stays visible.</Text>
        </Section>

        <Section
          title="Density (density.tsx)"
          note="Table density defaults to compact; comfortable is an opt-in that writes --table-row-py. Values below come from DENSITY_TOKENS."
        >
          {(["compact", "comfortable"] as const).map((d) => {
            const t = DENSITY_TOKENS[d];
            return (
              <Flex gap="md" align="center" style={{ padding: "6px 0", "border-bottom": "1px solid var(--color-fin-border)" }}>
                <Text size="xs" c="default" className="font-mono" style={{ width: "104px" }}>{d}</Text>
                <div style={{ padding: t.tableCellPad, height: `${t.tableRowHeight}px`, background: palette.SURFACE_ALT, border: `1px solid ${palette.BORDER}` }}>
                  <Text size="xs" c="dimmed" className="font-mono">row {t.tableRowHeight}px</Text>
                </div>
                <Text size="xs" c="dimmed" className="font-mono">
                  py {t.tableRowPy} · pad {t.tableCellPad} · panel {t.panelPad} · stat {t.statPad}
                </Text>
              </Flex>
            );
          })}
        </Section>
      </Stack>
    )),
};
