import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { Box, Button, Group, Stack, Text } from "@/ui";
import { AnimatedValue } from "@/components/common/AnimatedValue";
import { BrokerAuthNotice } from "@/components/common/BrokerAuthNotice";
import { Delta } from "@/components/common/KeyValue";
import { PnlText } from "@/components/common/PnlText";
import { TableEmptyState } from "@/components/common/TableEmptyState";
import { TableLoadingState } from "@/components/common/TableLoadingState";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack, Specimen } from "./StoryFrame";

const FIXTURE_LABEL = "frozen quote values · 2026-11-20 09:15 IST";
const PRICE_SEQUENCE = [23450.85, 23480.1, 23412.4, 23450.85] as const;
const priceFormat = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type ValuesArgs = {
  showNull: boolean;
  withFormat: boolean;
};

const meta: Meta<ValuesArgs> = {
  title: "App/Components/ValuesAndStates",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The value-and-state cluster shared across pages: `AnimatedValue` (direction flash on " +
          "a real change only), `Delta` (spoken P&L phrase), `PnlText`, the broker-auth notice and " +
          "the two table state wrappers. The story drives the animated value from a frozen, " +
          "cycled sequence — no timers, no random numbers, no network.",
      },
    },
  },
  args: { showNull: false, withFormat: true },
  argTypes: {
    showNull: { control: "boolean", description: "Render the null (em-dash) variant alongside the live value." },
    withFormat: { control: "boolean", description: "Apply the frozen en-IN price formatter." },
  },
};
export default meta;
type Story = StoryObj<ValuesArgs>;

const ValueStrip = (props: { children: import("solid-js").JSX.Element }) => (
  <Box style={{ padding: "12px 16px", "background-color": "var(--color-fin-surface-alt)", "border-radius": "4px" }}>
    {props.children}
  </Box>
);

/** A button cycles a frozen sequence, so the flash branch is observable without timers. */
export const AnimatedValues: Story = {
  render: (args) =>
    solidStory(() => {
      const [step, setStep] = createSignal(0);
      const value = () => PRICE_SEQUENCE[step() % PRICE_SEQUENCE.length];
      const format = args.withFormat ? (v: number) => priceFormat.format(v) : undefined;
      return (
        <DemoStack>
          <DemoPanel
            title="Values · animated quote"
            detail={`${FIXTURE_LABEL} · frozen sequence step ${step() + 1}/${PRICE_SEQUENCE.length}`}
            metaNode={
              <Text size="xs" c="secondary" aria-live="polite">{`frozen tick ${step() + 1}/${PRICE_SEQUENCE.length}`}</Text>
            }
            testId="story-animated-values-frame"
          >
            <Specimen label="Live value and null variant" detail="The flash fires only when the frozen value really changes.">
              <Stack gap="sm">
                <ValueStrip>
                  <Group gap="lg" align="center">
                    <AnimatedValue value={value()} format={format} testId="story-animated-live" />
                    {args.showNull && <AnimatedValue value={null} format={format} testId="story-animated-null" />}
                    <Text size="xs" c="secondary">NIFTY · frozen LTP</Text>
                  </Group>
                </ValueStrip>
                <Button size="xs" onClick={() => setStep((n) => n + 1)}>Next frozen tick</Button>
              </Stack>
            </Specimen>
          </DemoPanel>
        </DemoStack>
      );
    }),
};

export const ValueVocabulary: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Values · P&L and notice vocabulary"
          detail={FIXTURE_LABEL}
          meta="3 P&L tones · 2 animated values · 1 delta"
          testId="story-value-vocabulary-frame"
        >
          <Stack gap="md">
            <Specimen label="P&L text and animated values">
              <ValueStrip>
                <Group gap="lg" align="center" wrap="wrap">
                  <PnlText value={1240.5} />
                  <PnlText value={-318.25} />
                  <PnlText value={0} />
                  <AnimatedValue value={23450.85} format={(v) => priceFormat.format(v)} />
                  <AnimatedValue value={null} />
                </Group>
              </ValueStrip>
            </Specimen>
            <Specimen label="Spoken delta phrase">
              <ValueStrip>
                <Delta
                  entry="23,412.40"
                  mark="23,450.85"
                  pnl="+38.45"
                  value={38.45}
                  mono
                  ariaLabel="Entry 23,412.40 to mark 23,450.85, profit 38.45"
                  testId="story-value-delta"
                />
              </ValueStrip>
            </Specimen>
            <Specimen label="Broker connection notice">
              <Box style={{ "max-width": "520px" }}>
                <BrokerAuthNotice connectTestId="story-values-connect" />
              </Box>
            </Specimen>
          </Stack>
        </DemoPanel>
      </DemoStack>
    )),
};

export const TableStateWrappers: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Table states · empty and loading wrappers"
          detail={`${FIXTURE_LABEL} · wrappers around EmptyCompact / InlineLoader`}
          meta="1 empty · 2 loading"
          testId="story-table-state-wrappers-frame"
        >
          <Stack gap="md">
            <Specimen label="Empty body" detail="Optional icon and action are real props.">
              <ValueStrip>
                <TableEmptyState
                  message="No rows for this filter"
                  icon={<span aria-hidden="true">○</span>}
                  action={<Text size="xs" c="secondary">Widen the universe</Text>}
                />
              </ValueStrip>
            </Specimen>
            <Specimen label="Loading body" detail="Inline loader with a frozen message.">
              <ValueStrip>
                <TableLoadingState message="Loading frozen quotes" />
              </ValueStrip>
            </Specimen>
            <Specimen label="Custom loading slot" detail="Spinner suppressed; caller supplies the copy.">
              <ValueStrip>
                <TableLoadingState showSpinner={false}>
                  <Text size="xs" c="secondary">Reading the cached fixture…</Text>
                </TableLoadingState>
              </ValueStrip>
            </Specimen>
          </Stack>
        </DemoPanel>
      </DemoStack>
    )),
};
