import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { Box, Button, Group, SimpleGrid, Stack, Text } from "@/ui";
import {
  BadgeCell,
  DashCell,
  FlashValue,
  NumCell,
  SymbolCell,
  TextCell,
} from "@/components/common/tableCells";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack, Specimen } from "./StoryFrame";

const FIXTURE_LABEL = "NIFTY option chain · 2026-11-20 09:15 IST";
const priceFormat = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type CellArgs = {
  value: number;
  signed: boolean;
  dimmed: boolean;
};

const meta: Meta<CellArgs> = {
  title: "Design System/Components/App/TableCells",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Shared cell renderers from src/components/common/tableCells.tsx. Numbers are mono and " +
          "tabular everywhere so columns line up across surfaces; `NumCell` handles missing values " +
          "and signed P&L tones, `FlashValue` tints on a real change, `SymbolCell` is the identity " +
          "column with a keyboard-accessible open action, and `BadgeCell` centres status badges.",
      },
    },
  },
  args: { value: 1240.5, signed: true, dimmed: false },
  argTypes: {
    value: { control: "number", description: "Numeric value (set to a negative number for the loss tone)." },
    signed: { control: "boolean", description: "Colour by P&L semantics via getPnLTextColor." },
    dimmed: { control: "boolean", description: "Dimmed TextCell variant." },
  },
};
export default meta;
type Story = StoryObj<CellArgs>;

/** Cells are staged on a raised row strip so alignment is easy to read. */
const CellStrip = (props: { children: import("solid-js").JSX.Element }) => (
  <Box style={{ padding: "10px 16px", "background-color": "var(--color-fin-surface-alt)", "border-radius": "4px" }}>
    {props.children}
  </Box>
);

export const Playground: Story = {
  render: (args) =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Table cells · playground"
          detail={FIXTURE_LABEL}
          meta="Frozen execution snapshot"
          testId="story-cells-playground-frame"
        >
          <Specimen label="Numeric + identity cells" detail="Args bind to the real NumCell / TextCell props.">
            <CellStrip>
              <Group gap="lg" align="center" wrap="wrap">
                <NumCell
                  value={args.value}
                  signed={args.signed}
                  format={(v) => priceFormat.format(v)}
                  title="Frozen P&L cell"
                  testId="story-num-cell"
                />
                <TextCell value="RELIANCE INDUSTRIES" dimmed={args.dimmed} testId="story-text-cell" />
              </Group>
            </CellStrip>
          </Specimen>
        </DemoPanel>
      </DemoStack>
    )),
};

export const NumericAndDash: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Table cells · numeric and dash"
          detail={`${FIXTURE_LABEL} · right-aligned mono, explicit dash for missing`}
          meta="7 numeric states"
          testId="story-cells-numeric-frame"
        >
          <SimpleGrid cols={2} spacing="sm">
            <CellStrip><NumCell value={23450.85} format={(v) => priceFormat.format(v)} testId="story-cell-ltp" /></CellStrip>
            <CellStrip><NumCell value={-318.25} signed format={(v) => priceFormat.format(v)} testId="story-cell-loss" /></CellStrip>
            <CellStrip><NumCell value={1240.5} signed tone="success" format={(v) => `+${priceFormat.format(v)}`} /></CellStrip>
            <CellStrip><NumCell value={0} signed format={(v) => priceFormat.format(v)} /></CellStrip>
            <CellStrip><NumCell value={null} testId="story-cell-null" /></CellStrip>
            <CellStrip><NumCell value={Number.NaN} dash="n/a" /></CellStrip>
            <CellStrip><DashCell testId="story-dash-cell" title="No listing in this universe" /></CellStrip>
          </SimpleGrid>
        </DemoPanel>
      </DemoStack>
    )),
};

/** A button moves between two frozen values so the tint branch is observable. */
export const FlashValues: Story = {
  render: () =>
    solidStory(() => {
      const [tick, setTick] = createSignal(0);
      const value = () => (tick() % 2 === 0 ? 23450.85 : 23480.1);
      return (
        <DemoStack>
          <DemoPanel
            title="Table cells · flash on change"
            detail={`${FIXTURE_LABEL} · tick ${tick()}`}
            metaNode={<Text size="xs" c="secondary" aria-live="polite">{`frozen tick ${tick()}`}</Text>}
            testId="story-cells-flash-frame"
          >
            <Stack gap="sm">
              <CellStrip>
                <FlashValue value={value()} flashKey="story-flash-ltp" testId="story-flash-cell" />
              </CellStrip>
              <CellStrip>
                <FlashValue
                  value={value()}
                  flashKey="story-flash-labelled"
                  title="Frozen live LTP"
                  align="left"
                >
                  {`LTP ${priceFormat.format(value())}`}
                </FlashValue>
              </CellStrip>
              <Button size="xs" onClick={() => setTick((n) => n + 1)}>Next frozen tick</Button>
            </Stack>
          </DemoPanel>
        </DemoStack>
      );
    }),
};

export const TextSymbolAndBadges: Story = {
  render: () =>
    solidStory(() => {
      const [opened, setOpened] = createSignal("none");
      return (
        <DemoStack>
          <DemoPanel
            title="Table cells · identity, symbol and badges"
            detail={`${FIXTURE_LABEL} · last opened: ${opened()}`}
            metaNode={<Text size="xs" c="secondary" aria-live="polite">{`last opened: ${opened()}`}</Text>}
            testId="story-cells-identity-frame"
          >
            <Stack gap="sm">
              <Specimen label="Text cells">
                <CellStrip>
                  <Group gap="lg" align="center" wrap="wrap">
                    <TextCell value="NIFTY 24SEP FUT" fw={700} />
                    <TextCell value="no name on file" dimmed />
                    <TextCell value="23,450.85" mono />
                  </Group>
                </CellStrip>
              </Specimen>
              <Specimen label="Symbol cells with open action">
                <Stack gap="xs">
                  <CellStrip>
                    <SymbolCell
                      symbol="NIFTY"
                      name="Nifty 50 index"
                      onOpen={(symbol) => setOpened(symbol)}
                      testId="story-symbol-cell"
                    />
                  </CellStrip>
                  <CellStrip><SymbolCell symbol="RELIANCE" name="Reliance Industries" /></CellStrip>
                </Stack>
              </Specimen>
              <Specimen label="Status badges">
                <CellStrip>
                  <Group gap="md" align="center" wrap="wrap">
                    <BadgeCell label="LIVE" color="error" variant="filled" title="Live feed" />
                    <BadgeCell label="PAPER" color="success" />
                    <BadgeCell label="DELAYED" color="warning" variant="outline" />
                    <BadgeCell label="STALE" color="info" variant="light" />
                  </Group>
                </CellStrip>
              </Specimen>
            </Stack>
          </DemoPanel>
        </DemoStack>
      );
    }),
};
