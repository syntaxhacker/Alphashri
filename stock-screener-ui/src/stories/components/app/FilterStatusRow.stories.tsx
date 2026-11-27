import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal, For } from "solid-js";
import { Box, Chip, Text } from "@/ui";
import {
  FilterStatusRow,
  FILTER_STATUS_ROW_ARIA_LABEL,
  FILTER_STATUS_ROW_HEIGHT_CLASS,
} from "@/components/common/FilterStatusRow";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack, Specimen } from "./StoryFrame";

const FIXTURE_LABEL = "frozen active filters · 2026-11-20 09:15 IST";
const FILTERS = ["Large cap", "Positive change", "NIFTY 500", "High volume", "RSI < 70", "F&O only"] as const;

type FilterStatusArgs = {
  hasFilters: boolean;
  placeholder: string;
  clearAllLabel: string;
};

const meta: Meta<FilterStatusArgs> = {
  title: "App/Components/FilterStatusRow",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "An always-mounted, fixed-height (`h-6`) chip band from " +
          "src/components/common/FilterStatusRow.tsx. Chips stay on one line and scroll " +
          "horizontally, so applying a filter never shifts the table below it. The region is " +
          "labelled `" + FILTER_STATUS_ROW_ARIA_LABEL + "` and keyboard-scrollable; a right-edge " +
          "chevron appears only while more chips remain off-screen.",
      },
    },
  },
  args: {
    hasFilters: true,
    placeholder: "No filters",
    clearAllLabel: "Clear all",
  },
  argTypes: {
    hasFilters: { control: "boolean", description: "Swaps the muted placeholder for the chip strip." },
    placeholder: { control: "text", description: "Copy shown when no chip is active." },
    clearAllLabel: { control: "text", description: "Label of the optional clear-all button." },
  },
};
export default meta;
type Story = StoryObj<FilterStatusArgs>;

/** The band is staged inside a toolbar-like strip, the way the screener uses it. */
const FilterStrip = (props: { children: import("solid-js").JSX.Element }) => (
  <Box style={{ padding: "8px", "background-color": "var(--color-fin-surface-alt)", "border-radius": "4px" }}>
    {props.children}
  </Box>
);

/** Each chip has a visible label; the row itself carries the aria label. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => {
      const [checked, setChecked] = createSignal<boolean[]>(FILTERS.map((_, i) => i < 2));
      const hasFilters = () => (args.hasFilters ? checked().some(Boolean) : false);
      const active = () => FILTERS.filter((_, i) => checked()[i]);
      return (
        <DemoStack>
          <DemoPanel
            title="Filter status row · interactive"
            detail={FIXTURE_LABEL}
            metaNode={<Text size="xs" c="secondary" aria-live="polite">{`${active().length} of ${FILTERS.length} active`}</Text>}
            testId="story-filter-status-frame"
          >
            <Specimen label="Active filter band" detail={`${FILTER_STATUS_ROW_HEIGHT_CLASS} · chips stay on one line`}>
              <FilterStrip>
                <Box style={{ "max-width": "520px" }}>
                  <FilterStatusRow
                    testId="story-filter-status"
                    hasFilters={hasFilters()}
                    placeholder={args.placeholder}
                    onClearAll={() => setChecked(FILTERS.map(() => false))}
                    clearAllTestId="story-filter-clear"
                    clearAllLabel={args.clearAllLabel}
                  >
                    <For each={FILTERS}>
                      {(filter, index) => (
                        <Chip
                          label={filter}
                          size="xs"
                          checked={checked()[index()]}
                          onChange={(next) =>
                            setChecked((prev) => prev.map((value, i) => (i === index() ? next : value)))
                          }
                        />
                      )}
                    </For>
                  </FilterStatusRow>
                </Box>
              </FilterStrip>
              <Text size="xs" c="secondary" aria-live="polite">
                {`Active: ${active().join(", ") || "none"} · ${FILTER_STATUS_ROW_HEIGHT_CLASS}`}
              </Text>
            </Specimen>
          </DemoPanel>
        </DemoStack>
      );
    }),
};

/** The placeholder keeps a stable 24px band height. */
export const EmptyPlaceholder: Story = {
  render: (args) =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Filter status row · placeholder"
          detail={`${FIXTURE_LABEL} · no active chips`}
          meta="0 active · 24px band"
          testId="story-filter-empty-frame"
        >
          <FilterStrip>
            <Box style={{ "max-width": "480px" }}>
              <FilterStatusRow
                testId="story-filter-empty"
                hasFilters={false}
                placeholder={args.placeholder}
                clearAllLabel={args.clearAllLabel}
              />
            </Box>
          </FilterStrip>
        </DemoPanel>
      </DemoStack>
    )),
};

/** A narrow band with many chips exercises the horizontal scroll affordance. */
export const OverflowScroll: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Filter status row · overflow"
          detail={`${FIXTURE_LABEL} · scroll right to reach the last chip`}
          meta={`${FILTERS.length} chips · narrow band`}
          testId="story-filter-overflow-frame"
        >
          <FilterStrip>
            <Box style={{ width: "320px" }}>
              <FilterStatusRow
                testId="story-filter-overflow"
                hasFilters
                onClearAll={() => undefined}
                clearAllTestId="story-filter-overflow-clear"
              >
                <For each={FILTERS}>
                  {(filter) => <Chip label={filter} size="xs" checked />}
                </For>
              </FilterStatusRow>
            </Box>
          </FilterStrip>
        </DemoPanel>
      </DemoStack>
    )),
};
