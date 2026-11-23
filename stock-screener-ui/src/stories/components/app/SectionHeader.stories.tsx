import type { Meta, StoryObj } from "@storybook/html-vite";
import { Box, Stack } from "@/ui";
import { SectionHeader } from "@/components/common/SectionHeader";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack, Specimen } from "./StoryFrame";

const FIXTURE_LABEL = "frozen section headers · 2026-11-20 09:15 IST";

type SectionHeaderArgs = {
  title: string;
  badge: string;
  color: string;
};

const meta: Meta<SectionHeaderArgs> = {
  title: "Design System/Components/App/SectionHeader",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A four-pixel accent rail plus a title and optional count/status badge " +
          "(src/components/common/SectionHeader.tsx). `color` picks the accent class and the " +
          "badge tone together; unknown values fall back to the primary accent.",
      },
    },
  },
  args: { title: "Market breadth", badge: "12", color: "primary" },
  argTypes: {
    title: { control: "text", description: "Section title text." },
    badge: { control: "text", description: "Optional badge content (number or short status string)." },
    color: {
      control: "select",
      options: ["primary", "blue", "green", "red", "orange", "teal", "cyan", "violet", "grape"],
      description: "Accent rail + badge tone; unsupported names fall back to primary.",
    },
  },
};
export default meta;
type Story = StoryObj<SectionHeaderArgs>;

/** A header sits on a raised strip so the accent rail reads against a surface. */
const SectionStrip = (props: { children: import("solid-js").JSX.Element }) => (
  <Box style={{ padding: "8px 12px", "background-color": "var(--color-fin-surface-alt)", "border-radius": "4px" }}>
    {props.children}
  </Box>
);

/** Controls are bound to the real SectionHeaderProps. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Section header · playground"
          detail={FIXTURE_LABEL}
          meta={`accent: ${args.color}`}
          testId="story-section-header-frame"
        >
          <SectionStrip>
            <SectionHeader title={args.title} badge={args.badge} color={args.color} data-testid="story-section-header" />
          </SectionStrip>
        </DemoPanel>
      </DemoStack>
    )),
};

export const Accents: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Section header · known accent tokens"
          detail={`${FIXTURE_LABEL} · known accent tokens`}
          meta="9 accents"
          testId="story-section-accents-frame"
        >
          <Specimen label="Accent rail + badge tone">
            <Stack gap="xs">
              <SectionStrip><SectionHeader title="Default / primary" badge={12} /></SectionStrip>
              <SectionStrip><SectionHeader title="Blue" badge="INFO" color="blue" /></SectionStrip>
              <SectionStrip><SectionHeader title="Green" badge="LIVE" color="green" /></SectionStrip>
              <SectionStrip><SectionHeader title="Red" badge="STOP" color="red" /></SectionStrip>
              <SectionStrip><SectionHeader title="Orange" badge="WARN" color="orange" /></SectionStrip>
              <SectionStrip><SectionHeader title="Teal" badge="NULL" color="teal" /></SectionStrip>
              <SectionStrip><SectionHeader title="Cyan" badge="NULL" color="cyan" /></SectionStrip>
              <SectionStrip><SectionHeader title="Violet" badge="NULL" color="violet" /></SectionStrip>
              <SectionStrip><SectionHeader title="Grape" badge="NULL" color="grape" /></SectionStrip>
            </Stack>
          </Specimen>
        </DemoPanel>
      </DemoStack>
    )),
};

export const WithoutBadges: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Section header · no badge"
          detail={FIXTURE_LABEL}
          meta="title-only variants"
          testId="story-section-no-badges-frame"
        >
          <Stack gap="xs">
            <SectionStrip><SectionHeader title="Risk" color="warning" /></SectionStrip>
            <SectionStrip><SectionHeader title="Execution" color="orange" /></SectionStrip>
            <SectionStrip><SectionHeader title="Sector rotation" /></SectionStrip>
          </Stack>
        </DemoPanel>
      </DemoStack>
    )),
};
