import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Stack, Text, Title } from "@/ui";

const meta = {
  title: "Introduction/Overview",
  component: Box,
  parameters: {
    layout: "fullscreen",
    options: { showPanel: false },
    previewTabs: { "storybook/docs/panel": { hidden: false } },
    docs: { page: null },
  },
} satisfies Meta<typeof Box>;

export default meta;

const categories: Array<[string, string]> = [
  ["Layout", "Box · Flex · Stack · Group · Center · Paper · Card · ScrollArea · Divider · Collapse · SimpleGrid · Grid · Portal"],
  ["Typography", "Text · Title · Anchor · Code · List"],
  ["Inputs", "Button · ActionIcon · UnstyledButton · TextInput · NumberInput · Select · MultiSelect · Textarea · PasswordInput · Switch · Checkbox · Chip · SegmentedControl · CopyButton"],
  ["Feedback", "Badge · Alert · Loader · Progress · RingProgress · Skeleton · LoadingOverlay · Indicator"],
  ["Data Display", "Tabs · Accordion · Timeline · Tree · Menu"],
  ["Overlay", "Modal · Tooltip · Popover · Overlay"],
  ["Navigation", "NavLink · AppShell"],
  ["Misc", "Avatar · ThemeIcon · CloseButton"],
  ["Dates", "DatePicker"],
];

const commonComponents = [
  "TanStackTable",
  "CompactPage / CompactPanel / CompactStat / CompactStatGrid",
  "InlineLoader / EmptyState / ErrorAlert / EmptyCompact",
  "SideBadge / ExitReasonBadge / StatusBadge",
  "PnlText · ClickableSymbol · TradingDatePicker · CorrelationHeatmap",
];

function Overview() {
  return (
    <Box p="xl" maw={820}>
      <Title order={1}>Alphashri UI Library</Title>
      <Text c="dimmed" mt="xs" mb="lg">
        60 MUI wrapper components in <code>src/ui/</code> across 9 categories.
        Every component is theme-aware — toggle dark/light in the toolbar. Browse
        stories under <strong>Design System/UI/&lt;Category&gt;</strong>.
      </Text>

      {categories.map(([name, comps]) => (
        <Stack key={name} gap={4} mb="md">
          <Title order={4}>{name}</Title>
          <Text size="sm">{comps}</Text>
        </Stack>
      ))}

      <Title order={3} mt="xl">App-level common components</Title>
      <Text size="sm" c="dimmed" mb="xs">
        Shared composites from <code>src/components/common/</code>, documented in{" "}
        <strong>Design System/Common/*</strong>:
      </Text>
      <Stack gap={2}>
        {commonComponents.map((c) => (
          <Text key={c} size="sm">• {c}</Text>
        ))}
      </Stack>

      <Title order={3} mt="xl">Usage</Title>
      <Text size="sm" c="dimmed">
        Import from the barrel: <code>{`import { Button, Paper, Text } from "@/ui"`}</code>.
        Wrappers accept MUI props (subsetted) plus <code>data-testid</code>.
      </Text>
    </Box>
  );
}

export const OverviewPage: StoryObj = {
  render: () => <Overview />,
};
