import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { Box, Button, Stack, Text } from "@/ui";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack } from "./StoryFrame";

const FIXTURE_LABEL = "frozen panel boundary · 2026-11-20 09:15 IST";

type BoundaryArgs = {
  label: string;
  resetKey?: string | number | null;
};

const meta: Meta<BoundaryArgs> = {
  title: "App/Components/ErrorBoundary",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Panel/page render-error boundary from src/components/common/ErrorBoundary.tsx. " +
          "It catches JS/render/chunk errors (not browser-process crashes) and shows a generic " +
          "fallback with Try again and Reload page actions. Changing `resetKey` clears a caught " +
          "error — the demo below drives it from a frozen counter, without throwing during render " +
          "so autodocs stays stable.",
      },
    },
  },
  args: { label: "Market screener" },
  argTypes: {
    label: { control: "text", description: "Short surface name used in the fallback copy." },
    resetKey: { control: false, description: "Changing this value clears a caught error." },
  },
};
export default meta;
type Story = StoryObj<BoundaryArgs>;

/** The guarded surface is staged on a raised strip like a real panel body. */
const GuardedSurface = (props: { children: import("solid-js").JSX.Element }) => (
  <Box style={{ padding: "12px 16px", "background-color": "var(--color-fin-surface-alt)", "border-radius": "4px" }}>
    {props.children}
  </Box>
);

export const HealthyChild: Story = {
  render: (args) =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Error boundary · healthy child"
          detail={FIXTURE_LABEL}
          meta={`surface: ${args.label}`}
          testId="story-boundary-healthy-frame"
        >
          <GuardedSurface>
            <ErrorBoundary label={args.label} resetKey="frozen-session">
              <Text size="sm">The child rendered normally — the boundary is transparent on the happy path.</Text>
            </ErrorBoundary>
          </GuardedSurface>
        </DemoPanel>
      </DemoStack>
    )),
};

export const ResetKeyDriven: Story = {
  render: (args) =>
    solidStory(() => {
      const [generation, setGeneration] = createSignal(0);
      return (
        <DemoStack>
          <DemoPanel
            title="Error boundary · reset key"
            detail={`${FIXTURE_LABEL} · reset generation ${generation()}`}
            metaNode={
              <Text size="xs" c="secondary" aria-live="polite">{`generation ${generation()}`}</Text>
            }
            testId="story-boundary-reset-frame"
          >
            <Stack gap="sm">
              <GuardedSurface>
                <ErrorBoundary label={args.label} resetKey={generation()}>
                  <Text size="sm">{`Rendered child, generation ${generation()} — changing resetKey remounts it.`}</Text>
                </ErrorBoundary>
              </GuardedSurface>
              <Button size="xs" onClick={() => setGeneration((n) => n + 1)}>Next frozen generation</Button>
            </Stack>
          </DemoPanel>
        </DemoStack>
      );
    }),
};
