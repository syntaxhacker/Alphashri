import type { Meta, StoryObj } from "@storybook/html-vite";
import type { JSX } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Anchor, Code, Divider, Flex, List, Paper, Stack, Text, Title } from "@/ui";
import * as palette from "@/ui/palette";

const meta: Meta = {
  title: "Design System/Typography",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Every sample is rendered with the local Text / Title / Anchor / Code / List primitives. Tones, sizes and behaviour below come from their implementations in src/ui/typography.",
      },
    },
  },
};
export default meta;

type Story = StoryObj;

const Section = (props: { title: string; note?: string; children: JSX.Element }) => (
  <Paper p="md" radius="md" style={{ border: "1px solid var(--color-fin-border)" }}>
    <Stack gap="sm">
      <Title order={3} size="md">{props.title}</Title>
      {props.note ? <Text size="xs" c="dimmed">{props.note}</Text> : null}
      {props.children}
    </Stack>
  </Paper>
);

const longText =
  "Open interest builds on the call wall while spot holds above the put wall, so the 5-minute flow read stays constructive into expiry.";

export const TextTones: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "880px" }}>
        <Section
          title="Text tones"
          note="All nine values accepted by Text's c prop. Utilities (not inline colours) are used so theme overrides and className still win."
        >
          {(["primary", "secondary", "success", "error", "warning", "info", "danger", "dimmed", "default"] as const).map((tone) => (
            <Flex gap="md" style={{ padding: "4px 0", "border-bottom": "1px solid var(--color-fin-border)" }}>
              <Text size="xs" c="dimmed" className="font-mono" style={{ width: "96px" }}>{tone}</Text>
              <Text size="sm" c={tone}>{tone} — Alphashri terminal 1,234.56</Text>
            </Flex>
          ))}
          <Text size="xs" c="dimmed">
            secondary and dimmed both resolve to TEXT_MUTED; error and danger both resolve to NEGATIVE. Title and Anchor map info to PRIMARY instead — check the component before assuming a tone matches.
          </Text>
        </Section>
        <Section title="Literal colour escape hatch" note="A c value that looks like a colour is painted inline; Token names are utilities.">
          <Text size="sm" c={palette.POSITIVE}>c=palette.POSITIVE renders as an inline colour value.</Text>
        </Section>
      </Stack>
    )),
};

export const TextWeightsAndSizes: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "880px" }}>
        <Section title="Weights" note="fw takes the named weights or any number; 500 is the medium emphasis used for numeric data.">
          <Flex gap="sm" align="baseline" wrap="wrap">
            <Text size="md" fw="normal">normal</Text>
            <Text size="md" fw={500}>500 medium</Text>
            <Text size="md" fw="semibold">semibold</Text>
            <Text size="md" fw={700}>700 bold</Text>
          </Flex>
          <Divider label="Numeric emphasis" labelPosition="left" />
          <Flex gap="lg" align="baseline" wrap="wrap">
            <Text size="sm" fw={500} className="font-mono">LTP 23,450.85</Text>
            <Text size="sm" fw={600} c="success" className="font-mono">+1,240.50</Text>
            <Text size="sm" fw={700} c="error" className="font-mono">-318.25</Text>
          </Flex>
        </Section>
        <Section title="Sizes on Text" note="xs 12 · sm 14 · md 16 · lg 18 · xl 20px from Text's sizeMap.">
          <Stack gap="xs">
            {(["xs", "sm", "md", "lg", "xl"] as const).map((size) => (
              <Text size={size}>size=&quot;{size}&quot; — market terminal 1,234.56</Text>
            ))}
          </Stack>
        </Section>
      </Stack>
    )),
};

export const TextLayoutProps: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "880px" }}>
        <Section title="Text alignment (ta)" note="left / center / right — useful inside fixed-width cells.">
          <Stack gap="xs" style={{ width: "360px" }}>
            {(["left", "center", "right"] as const).map((ta) => (
              <Text size="sm" ta={ta} style={{ "background-color": palette.SURFACE_ALT, padding: "4px 8px" }}>
                ta={ta}
              </Text>
            ))}
          </Stack>
        </Section>
        <Section title="Text transform (tt)" note="uppercase for section labels, capitalize for headings, lowercase / none as required.">
          <Flex gap="lg" align="baseline" wrap="wrap">
            {(["uppercase", "lowercase", "capitalize", "none"] as const).map((tt) => (
              <Text size="sm" tt={tt}>open interest by strike</Text>
            ))}
          </Flex>
        </Section>
        <Section title="Line height (lh) and font style (fs)" note="lh accepts a unitless number or CSS length; fs is font-style, e.g. italic.">
          <Stack gap="sm" style={{ width: "420px" }}>
            <Text size="sm" lh={1}>lh=1 — dense single-line labels stay tight and readable.</Text>
            <Text size="sm" lh={1.8}>lh=1.8 — wider leading for short explanatory copy that wraps.</Text>
            <Text size="sm" fs="italic">fs=italic — a caveat or secondary annotation.</Text>
          </Stack>
        </Section>
      </Stack>
    )),
};

export const TruncationAndClamp: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "880px" }}>
        <Section title="Truncate (end and start)" note="truncate sets overflow, nowrap and an ellipsis. 'start' flips direction so the beginning is elided; keep the full value in title.">
          <Stack gap="sm" style={{ width: "420px" }}>
            <Text size="sm" truncate title={longText}>{longText}</Text>
            <Text size="sm" truncate="end" title={longText}>{longText}</Text>
            <Text size="sm" truncate="start" title={longText}>{longText}</Text>
          </Stack>
        </Section>
        <Section title="Line clamp" note="lineClamp=n clips to n lines with -webkit-line-clamp; pair with title for the full text.">
          <Stack gap="sm" style={{ width: "420px" }}>
            <Text size="sm" lineClamp={1} title={longText}>1 line — {longText}</Text>
            <Text size="sm" lineClamp={2} title={longText}>2 lines — {longText}</Text>
            <Text size="sm" lineClamp={3} title={longText}>3 lines — {longText}</Text>
          </Stack>
        </Section>
      </Stack>
    )),
};

export const ElementComposition: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "880px" }}>
        <Section title="component and span" note="Text renders p by default; span switches to an inline element, component picks any supported intrinsic tag.">
          <Text size="sm">A paragraph by default.{" "}
            <Text size="sm" span c="primary">span inline</Text>
            {" "}inside the flow, followed by{" "}
            <Text size="sm" component="code" className="font-mono" style={{ "background-color": palette.SURFACE_ALT, padding: "2px 6px" }}>
              component=&quot;code&quot;
            </Text>
            .
          </Text>
          <Divider label="Block element override" labelPosition="left" />
          <Text size="sm" component="div" c="dimmed">component=&quot;div&quot; renders a block element while keeping the type styles.</Text>
        </Section>
        <Section title="Spacing props" note="Text's numeric p/px/py/mt/… multiply by 8; named space tokens use spacing.ts.">
          <Text size="sm" c="default" style={{ "background-color": palette.SURFACE_ALT, display: "inline-block" }} p="sm" m={1}>
            p=&quot;sm&quot; (8px), m=&#123;1&#125; (8px)
          </Text>
        </Section>
      </Stack>
    )),
};

export const TitleVariants: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "880px" }}>
        <Section title="Order → semantic element" note="order 1…6 renders h1…h6. It sets the tag, not the size — pass size explicitly for a token-driven font-size.">
          <Stack gap="xs">
            {([1, 2, 3, 4, 5, 6] as const).map((order) => (
              <Title order={order} size="md">order=&#123;{order}&#125; → h{order}</Title>
            ))}
          </Stack>
        </Section>
        <Section title="Title sizes" note="Title's scale: xs 12 · sm 14 · md 16 · lg 18 · xl 24px.">
          <Stack gap="xs">
            {(["xs", "sm", "md", "lg", "xl"] as const).map((size) => (
              <Title order={3} size={size}>Title size=&quot;{size}&quot;</Title>
            ))}
          </Stack>
        </Section>
        <Section title="Component override and tones" note="component changes the element while order stays for semantics; c accepts the same tone names as Text.">
          <Title order={4} component="h2" c="primary" size="lg">An h2 element with order=4</Title>
          <Title order={4} c="success" size="md">Positive tone title</Title>
          <Title order={4} c="dimmed" size="md">Dimmed tone title</Title>
          <Title order={4} size="md" fw={500} lh={1.4} ta="center">fw / lh / ta also apply</Title>
        </Section>
      </Stack>
    )),
};

export const AnchorVariants: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "880px" }}>
        <Section title="Underline behaviour" note="underline: always adds a permanent underline, none removes it, hover (default) underlines on hover only.">
          <Flex gap="lg" wrap="wrap">
            <Anchor href="#anchors" underline="always">always</Anchor>
            <Anchor href="#anchors" underline="hover">hover (default)</Anchor>
            <Anchor href="#anchors" underline="never">never</Anchor>
          </Flex>
        </Section>
        <Section title="Tones and sizes" note="Anchor's info tone resolves to PRIMARY in Anchor.tsx; other tones mirror Text.">
          <Flex gap="lg" wrap="wrap" align="baseline">
            <Anchor href="#anchors" c="info">info link</Anchor>
            <Anchor href="#anchors" c="success">success link</Anchor>
            <Anchor href="#anchors" c="dimmed">dimmed link</Anchor>
            <Anchor href="#anchors" size="xs">xs</Anchor>
            <Anchor href="#anchors" size="md" fw={500}>md / 500</Anchor>
          </Flex>
        </Section>
        <Section title="Truncate, target and component" note="href/target only reach the DOM when the root stays an a; component='span' keeps the styling without navigation.">
          <Text size="sm" style={{ width: "320px" }}>
            <Anchor href="#anchors" truncate title="A deliberately long link label that is clipped to demonstrate truncation">
              A deliberately long link label that is clipped to demonstrate truncation
            </Anchor>
          </Text>
          <Text size="sm"><Anchor href="#anchors" target="_blank">Opens in a new tab</Anchor></Text>
          <Text size="sm">Inline <Anchor component="span" c="primary">span-styled anchor</Anchor> inside body copy.</Text>
        </Section>
      </Stack>
    )),
};

export const CodeVariants: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "880px" }}>
        <Section title="Inline and block" note="Code uses the mono utility; block renders a pre with wrapping and horizontal overflow.">
          <Text size="sm">
            Inline: <Code>useValueFlash</Code> and <Code color="primary">PRIMARY</Code>.
          </Text>
          <Code block>{`const cutoff = aggregate.rangeCutoff(asOf, "6m");\nconst rows = await fetchPrices({ range: cutoff });`}</Code>
        </Section>
        <Section title="Semantic fills" note="color maps to a palette fill and picks readable ink for it — never text directly on a saturated colour.">
          <Flex gap="sm" wrap="wrap">
            {(["primary", "success", "error", "warning", "info", "dimmed"] as const).map((c) => (
              <Code color={c}>{c}</Code>
            ))}
            <Code>default</Code>
          </Flex>
        </Section>
      </Stack>
    )),
};

export const ListVariants: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "880px" }}>
        <Section title="Ordered and unordered" note="type selects ol/ul; withPadding adds the 24px indent, size uses the shared type scale.">
          <List withPadding size="sm">
            <List.Item>Panels are separated by hairlines, not nested borders.</List.Item>
            <List.Item>Numbers use the mono stack and tabular figures.</List.Item>
            <List.Item>States are tone-coded, never hue-invented.</List.Item>
          </List>
          <Divider label="ordered" labelPosition="left" />
          <List type="ordered" withPadding listStyleType="decimal" size="sm">
            <List.Item>Read the token from the source module.</List.Item>
            <List.Item>Render it with the local primitive.</List.Item>
            <List.Item>Verify it on a real surface.</List.Item>
          </List>
        </Section>
        <Section title="Icons and alignment" note="List.Item takes an icon slot; center and listStyleType pass straight through to the list element.">
          <List size="sm" listStyleType="none" center>
            <List.Item icon={<Text size="xs" c="success" span>▲</Text>}>Positive flow</List.Item>
            <List.Item icon={<Text size="xs" c="error" span>▼</Text>}>Negative flow</List.Item>
          </List>
        </Section>
      </Stack>
    )),
};
