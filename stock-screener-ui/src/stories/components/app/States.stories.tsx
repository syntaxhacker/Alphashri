import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal, Show } from "solid-js";
import { Box, Button, Group, Stack, Text } from "@/ui";
import {
  EmptyCompact,
  EmptyState,
  ErrorAlert,
  InlineLoader,
  type EmptyStateKind,
  type EmptyStateTone,
} from "@/components/common/states";
import { TableEmptyState } from "@/components/common/TableEmptyState";
import { TableLoadingState } from "@/components/common/TableLoadingState";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack, Specimen } from "./StoryFrame";

const FIXTURE_LABEL = "frozen feed states · 2026-11-20 09:15 IST";

type StatesArgs = {
  emptyKind: EmptyStateKind;
  layout: "stack" | "row";
  title: string;
  description: string;
  hint: string;
  tone: EmptyStateTone;
  showSpinner: boolean;
};

const meta: Meta<StatesArgs> = {
  title: "App/Components/States",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Shared empty / error / loading primitives from src/components/common/states.tsx and " +
          "the two table state wrappers. The three emptinesses are deliberately distinct: " +
          "no-data (nothing recorded), market-closed (expected) and failed (retryable). " +
          "`layout=\"row\"` is the dense one-line rail band; `stack` is the centred panel card.",
      },
    },
  },
  args: {
    emptyKind: "no-data",
    layout: "stack",
    title: "Nothing recorded",
    description: "The recorder was not running for this session",
    hint: "Next capture: 09:15 IST",
    tone: "muted",
    showSpinner: true,
  },
  argTypes: {
    emptyKind: {
      control: "select",
      options: ["no-data", "market-closed", "failed"],
      description: "Fixes tone, glyph and default copy for the three kinds of emptiness.",
    },
    layout: { control: "inline-radio", options: ["stack", "row"], description: "Centred card vs dense rail band." },
    title: { control: "text", description: "Primary explanation line." },
    description: { control: "text", description: "One flowing secondary line." },
    hint: { control: "text", description: "Optional muted footnote about cadence or next step." },
    tone: {
      control: "select",
      options: ["muted", "info", "warning", "error"],
      description: "Ink for the glyph tile; the copy stays at AA contrast.",
    },
    showSpinner: { control: "boolean", description: "InlineLoader spinner visibility." },
  },
};
export default meta;
type Story = StoryObj<StatesArgs>;

const StateStrip = (props: { children: import("solid-js").JSX.Element }) => (
  <Box style={{ padding: "12px 16px", "background-color": "var(--color-fin-surface-alt)", "border-radius": "4px" }}>
    {props.children}
  </Box>
);

/** Controls bind to the real EmptyState props. */
export const EmptyPlayground: Story = {
  render: (args) =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="States · empty playground"
          detail={FIXTURE_LABEL}
          meta={`${args.emptyKind} · ${args.layout} · ${args.tone}`}
          testId="story-empty-playground-frame"
        >
          <StateStrip>
            <EmptyState
              kind={args.emptyKind}
              layout={args.layout}
              title={args.title}
              description={args.description}
              hint={args.hint}
              tone={args.tone}
              data-testid="story-empty-playground"
              descriptionTestId="story-empty-description"
            />
          </StateStrip>
        </DemoPanel>
      </DemoStack>
    )),
};

export const ThreeKinds: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="States · three kinds of emptiness"
          detail={`${FIXTURE_LABEL} · each kind carries its own tone and glyph`}
          meta="no-data · market-closed · failed"
          testId="story-three-kinds-frame"
        >
          <Stack gap="sm">
            <Specimen label="No data">
              <StateStrip><EmptyState kind="no-data" hint="No session capture is available" /></StateStrip>
            </Specimen>
            <Specimen label="Market closed">
              <StateStrip><EmptyState kind="market-closed" hint="Recording resumes at the next open" /></StateStrip>
            </Specimen>
            <Specimen label="Failed">
              <StateStrip><EmptyState kind="failed" hint="Retry once before raising a ticket" /></StateStrip>
            </Specimen>
          </Stack>
        </DemoPanel>
      </DemoStack>
    )),
};

export const RowLayout: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="States · row layout"
          detail={`${FIXTURE_LABEL} · fixed-height rail bands`}
          meta="3 rail bands"
          testId="story-row-layout-frame"
        >
          <StateStrip>
            <Stack gap="xs">
              <EmptyState kind="market-closed" layout="row" hint="Resumes 09:15 IST" data-testid="story-row-closed" />
              <EmptyState kind="no-data" layout="row" hint="Recorder off" data-testid="story-row-nodata" />
              <EmptyState kind="failed" layout="row" hint="Feed unavailable" data-testid="story-row-failed" />
            </Stack>
          </StateStrip>
        </DemoPanel>
      </DemoStack>
    )),
};

/** Retry is a real callback; no timers or random state. */
export const ErrorAndRetry: Story = {
  render: () =>
    solidStory(() => {
      const [failed, setFailed] = createSignal(true);
      const [attempts, setAttempts] = createSignal(0);
      const retry = () => {
        setAttempts((n) => n + 1);
        setFailed(false);
      };
      return (
        <DemoStack>
          <DemoPanel
            title="States · error and retry"
            detail={FIXTURE_LABEL}
            metaNode={
              <Text size="xs" c="secondary" aria-live="polite">{`${attempts()} manual retr${attempts() === 1 ? "y" : "ies"} so far`}</Text>
            }
            testId="story-error-retry-frame"
          >
            <StateStrip>
              <Show
                when={failed()}
                fallback={
                  <Text size="sm" c="success" aria-live="polite">
                    {`Feed reloaded after ${attempts()} manual retr${attempts() === 1 ? "y" : "ies"}.`}
                  </Text>
                }
              >
                <ErrorAlert
                  title="Feed unavailable"
                  message="The frozen tape fixture could not be loaded."
                  withRetry
                  onRetry={retry}
                  onClose={() => setFailed(false)}
                  data-testid="story-error-alert"
                />
              </Show>
            </StateStrip>
          </DemoPanel>
        </DemoStack>
      );
    }),
};

export const Loading: Story = {
  render: (args) =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="States · loading"
          detail={FIXTURE_LABEL}
          meta={args.showSpinner ? "spinner on · 3 variants" : "spinner off · 3 variants"}
          testId="story-loading-frame"
        >
          <Stack gap="md">
            <Specimen label="Inline loader">
              <StateStrip>
                <InlineLoader data-testid="story-inline-loader" message="Loading option chain" showSpinner={args.showSpinner} />
              </StateStrip>
            </Specimen>
            <Specimen label="Table loading wrapper">
              <StateStrip>
                <TableLoadingState message="Loading paper positions" showSpinner={args.showSpinner} />
              </StateStrip>
            </Specimen>
            <Specimen label="Custom loading slot">
              <StateStrip>
                <TableLoadingState showSpinner={false}>
                  <Text size="xs" c="secondary">Fetching a frozen snapshot…</Text>
                </TableLoadingState>
              </StateStrip>
            </Specimen>
          </Stack>
        </DemoPanel>
      </DemoStack>
    )),
};

export const TableStates: Story = {
  render: () =>
    solidStory(() => {
      const [resets, setResets] = createSignal(0);
      return (
        <DemoStack>
          <DemoPanel
            title="States · table wrappers"
            detail={FIXTURE_LABEL}
            metaNode={<Text size="xs" c="secondary" aria-live="polite">{`reset actions: ${resets()}`}</Text>}
            testId="story-table-states-frame"
          >
            <Stack gap="md">
              <Specimen label="Table empty state" detail="Recovery action is a real callback.">
                <StateStrip>
                  <TableEmptyState
                    message="No rows for this filter"
                    icon={<span aria-hidden="true">○</span>}
                    action={
                      <Button size="xs" aria-label="Reset filters" onClick={() => setResets((n) => n + 1)}>
                        Reset filters
                      </Button>
                    }
                  />
                </StateStrip>
              </Specimen>
              <Specimen label="Compact empty state">
                <StateStrip>
                  <EmptyCompact
                    title="No strikes in range"
                    description="Widen the strike band or pick another expiry"
                    emoji="○"
                    data-testid="story-empty-compact"
                  />
                </StateStrip>
              </Specimen>
              <Specimen label="Optional recovery action">
                <StateStrip>
                  <Group gap="sm" align="center">
                    <Text size="xs" c="secondary">Recovery action is optional:</Text>
                    <EmptyState
                      layout="row"
                      title="No saved layout"
                      action={<Button size="xs" aria-label="Create layout">Create</Button>}
                    />
                  </Group>
                </StateStrip>
              </Specimen>
            </Stack>
          </DemoPanel>
        </DemoStack>
      );
    }),
};
