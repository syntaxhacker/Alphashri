import type { Meta, StoryObj } from "@storybook/html-vite";
import { Box, SimpleGrid, Stack, Text } from "@/ui";
import {
  Icon,
  IconActivity,
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowDown,
  IconArrowUp,
  IconChartCandle,
  IconChartLine,
  IconCheck,
  IconChevronRight,
  IconDatabaseOff,
  IconExternalLink,
  IconMoon,
  IconSearch,
  IconSettings,
} from "@/components/common/Icons";
import * as palette from "@/ui/palette";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack, Specimen } from "./StoryFrame";

const FIXTURE_LABEL = "frozen icon set · stroke 2, semantic colours from palette";

type IconArgs = {
  size: number;
  stroke: number;
  color: string;
  name: string;
};

const meta: Meta<IconArgs> = {
  title: "App/Components/Icons",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The shared inline SVG icon set from src/components/common/Icons.tsx. `Icon` takes a " +
          "name and the exported `IconX` components are thin wrappers. Paths are merged at " +
          "module load so a grid of icons costs one node each; `color` accepts a palette export " +
          "or CSS variable, never a literal hex.",
      },
    },
  },
  args: { size: 18, stroke: 2, color: palette.TEXT, name: "activity" },
  argTypes: {
    name: { control: "text", description: "Registered tabler-style icon name (kebab or camel case)." },
    size: { control: { type: "range", min: 12, max: 32, step: 2 }, description: "Rendered size." },
    stroke: { control: { type: "range", min: 1, max: 3, step: 0.5 }, description: "Stroke width override." },
    color: { control: "text", description: "Stroke colour (palette export or CSS variable)." },
  },
};
export default meta;
type Story = StoryObj<IconArgs>;

/** One tile per icon: name below the glyph, raised surface behind it. */
const IconTile = (props: { name: string; children: import("solid-js").JSX.Element }) => (
  <Box style={{ padding: "12px 8px", "background-color": "var(--color-fin-surface-alt)", "border-radius": "4px", "text-align": "center" }}>
    <Stack gap="xs" align="center">
      {props.children}
      <Text size="xs" c="secondary">{props.name}</Text>
    </Stack>
  </Box>
);

export const Playground: Story = {
  render: (args) =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Icons · generic Icon component"
          detail={FIXTURE_LABEL}
          meta={`${args.size}px · stroke ${args.stroke}`}
          testId="story-icon-playground-frame"
        >
          <IconTile name={args.name}>
            <Icon name={args.name} size={args.size} stroke={args.stroke} color={args.color} data-testid="story-icon-generic" />
          </IconTile>
        </DemoPanel>
      </DemoStack>
    )),
};

export const SemanticSet: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Icons · semantic colour set"
          detail={FIXTURE_LABEL}
          meta="15 glyphs · 3 groups"
          testId="story-icon-semantic-frame"
        >
          <Specimen label="Trend and status">
            <SimpleGrid cols={6} spacing="xs">
              <IconTile name="activity"><IconActivity size={20} color={palette.PRIMARY} /></IconTile>
              <IconTile name="chart-candle"><IconChartCandle size={20} color={palette.INFO} /></IconTile>
              <IconTile name="chart-line"><IconChartLine size={20} color={palette.POSITIVE} /></IconTile>
              <IconTile name="arrow-up"><IconArrowUp size={20} color={palette.POSITIVE} /></IconTile>
              <IconTile name="arrow-down"><IconArrowDown size={20} color={palette.NEGATIVE} /></IconTile>
              <IconTile name="check"><IconCheck size={20} color={palette.POSITIVE} /></IconTile>
            </SimpleGrid>
          </Specimen>
          <Specimen label="Alerts and navigation">
            <SimpleGrid cols={6} spacing="xs">
              <IconTile name="alert-circle"><IconAlertCircle size={20} color={palette.NEGATIVE} /></IconTile>
              <IconTile name="alert-triangle"><IconAlertTriangle size={20} color={palette.WARNING} /></IconTile>
              <IconTile name="database-off"><IconDatabaseOff size={20} color={palette.TEXT_MUTED} /></IconTile>
              <IconTile name="moon"><IconMoon size={20} color={palette.INFO} /></IconTile>
              <IconTile name="chevron-right"><IconChevronRight size={20} color={palette.TEXT_MUTED} /></IconTile>
            </SimpleGrid>
          </Specimen>
          <Specimen label="Neutral chrome">
            <SimpleGrid cols={6} spacing="xs">
              <IconTile name="search"><IconSearch size={20} /></IconTile>
              <IconTile name="settings"><IconSettings size={20} /></IconTile>
              <IconTile name="external-link"><IconExternalLink size={20} /></IconTile>
            </SimpleGrid>
          </Specimen>
        </DemoPanel>
      </DemoStack>
    )),
};
