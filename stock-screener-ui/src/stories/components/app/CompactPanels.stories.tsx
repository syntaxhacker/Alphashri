import type { Meta, StoryObj } from "@storybook/html-vite";
import { Box, Button, Group, Stack, Text } from "@/ui";
import {
  CompactPage,
  CompactPanel,
  CompactStat,
  CompactStatGrid,
} from "@/components/common/compact";
import { solidStory } from "@/stories/solidStory";
import { DEMO_WIDTH, DemoStack, Specimen } from "./StoryFrame";

const FIXTURE_LABEL = "frozen NIFTY desk snapshot · 2026-11-20 09:15 IST";
const SPOT = "23,450.85";

type CompactArgs = {
  cols: number;
  padded: boolean;
  flush: boolean;
  dense: boolean;
};

const meta: Meta<CompactArgs> = {
  title: "App/Components/CompactPanels",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Compact layout primitives from src/components/common/compact.tsx. " +
          "`CompactPanel` is the one-border panel with an uppercase mono header; " +
          "`CompactStat` / `CompactStatGrid` form a single row of cells with divide lines; " +
          "`CompactPage` is the scrollable page shell. Theme tokens are used throughout, " +
          "never baked palette colours.",
      },
    },
  },
  args: { cols: 4, padded: true, flush: false, dense: false },
  argTypes: {
    cols: { control: { type: "range", min: 1, max: 6, step: 1 }, description: "CompactStatGrid cells per row (defaults to 4)." },
    padded: { control: "boolean", description: "Panel body padding on/off." },
    flush: { control: "boolean", description: "Edge-to-edge header divider aligned to the grid." },
    dense: { control: "boolean", description: "Smaller CompactStat fonts and tighter padding." },
  },
};
export default meta;
type Story = StoryObj<CompactArgs>;

/** CompactPanel already supplies the one border; the wrapper only gives context. */
const DeskSurface = (props: { children: import("solid-js").JSX.Element }) => (
  <Box style={{ padding: "8px", "background-color": "var(--color-fin-surface-alt)", "border-radius": "4px" }}>
    {props.children}
  </Box>
);

/** Controls bind to the panel and stat grid props. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => (
      <DemoStack>
        <Specimen
          label="Compact panels · playground"
          detail={`${FIXTURE_LABEL} · cols ${args.cols} · padded ${args.padded} · flush ${args.flush} · dense ${args.dense}`}
        >
          <DeskSurface>
            <Stack gap="md">
              <CompactPanel
                title="NIFTY option chain"
                description={`Spot ${SPOT} · 26 Nov 2026 expiry`}
                padded={args.padded}
                flush={args.flush}
                action={<Button size="xs" aria-label="Refresh chain">Refresh</Button>}
                testId="story-compact-panel"
              >
                <Text size="xs" c="secondary">458 frozen strike rows · 09:15:00 IST</Text>
              </CompactPanel>
              <CompactStatGrid cols={args.cols}>
                <CompactStat label="Spot" value={SPOT} hint="+18.42 (0.08%)" tone="success" dense={args.dense} />
                <CompactStat label="PCR (OI)" value="1.12" tone="success" dense={args.dense} />
                <CompactStat label="Max Pain" value="23,400" dense={args.dense} />
                <CompactStat label="Pin Risk" value="HIGH" tone="warning" dense={args.dense} />
              </CompactStatGrid>
            </Stack>
          </DeskSurface>
        </Specimen>
      </DemoStack>
    )),
};

export const PanelVariations: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <Specimen label="Compact panels · variations" detail={`${FIXTURE_LABEL} · padded / flush / scrollable`}>
          <DeskSurface>
            <Stack gap="md">
              <CompactPanel title="Padded" description="Default 8px body padding" padded>
                <Text size="xs">Header, description and action share one bordered surface.</Text>
              </CompactPanel>
              <CompactPanel title="Flush" description="Header aligned to the grid" flush>
                <Box style={{ padding: "8px", "border-top": "1px solid var(--color-fin-border)" }}>
                  <Text size="xs">Body keeps the panel pad while the header spans the full width.</Text>
                </Box>
              </CompactPanel>
              <CompactPanel title="No padding" description="Edge-to-edge content" padded={false}>
                <Box style={{ padding: "8px" }}>
                  <Text size="xs">The caller owns all inner spacing.</Text>
                </Box>
              </CompactPanel>
              <Box style={{ height: "120px", display: "flex" }}>
                <CompactPanel title="Scrollable" description="Fixed-height flex parent" scrollable>
                  <Stack gap="xs">
                    <Text size="xs">First frozen row</Text>
                    <Text size="xs">Second frozen row</Text>
                    <Text size="xs">Third frozen row</Text>
                    <Text size="xs">Fourth frozen row</Text>
                    <Text size="xs">Fifth frozen row</Text>
                    <Text size="xs">Sixth frozen row</Text>
                  </Stack>
                </CompactPanel>
              </Box>
            </Stack>
          </DeskSurface>
        </Specimen>
      </DemoStack>
    )),
};

export const StatVariations: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <Specimen label="Compact stats · variations" detail={`${FIXTURE_LABEL} · tones, hints and dense cells`}>
          <DeskSurface>
            <Stack gap="md">
              <CompactStatGrid cols={4}>
                <CompactStat label="Net P&L" value="+₹2,883.75" tone="success" hint="gross ₹3,101" />
                <CompactStat label="Day P&L" value="-₹1,880.00" tone="error" hint="RELIANCE" />
                <CompactStat label="Margin" value="82%" tone="warning" />
                <CompactStat label="Feed" value="DELAYED" tone="info" />
              </CompactStatGrid>
              <CompactStatGrid cols={6}>
                <CompactStat label="Spot" value={SPOT} dense />
                <CompactStat label="PCR" value="1.12" dense />
                <CompactStat label="Max Pain" value="23,400" dense />
                <CompactStat label="Pin Risk" value="HIGH" tone="warning" dense />
                <CompactStat label="OI" value="1.20M" dense />
                <CompactStat label="Volume" value="842K" dense />
              </CompactStatGrid>
            </Stack>
          </DeskSurface>
        </Specimen>
      </DemoStack>
    )),
};

export const PageShell: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <Specimen label="Compact page shell" detail={FIXTURE_LABEL}>
          <Box style={{ width: `${DEMO_WIDTH}px`, height: "360px" }}>
            <CompactPage
              title="Frozen desk page"
              description={FIXTURE_LABEL}
              actions={<Group gap="xs"><Button size="xs" aria-label="Page action A">A</Button><Button size="xs" aria-label="Page action B">B</Button></Group>}
            >
              <Stack gap="sm">
                <CompactPanel title="Snapshot" description="09:15:00 IST">
                  <Text size="xs">The page body scrolls; the header stays in flow.</Text>
                </CompactPanel>
                <CompactStatGrid cols={4}>
                  <CompactStat label="Spot" value={SPOT} />
                  <CompactStat label="PCR" value="1.12" />
                  <CompactStat label="Max Pain" value="23,400" />
                  <CompactStat label="Feed" value="DELAYED" tone="info" />
                </CompactStatGrid>
              </Stack>
            </CompactPage>
          </Box>
        </Specimen>
      </DemoStack>
    )),
};
