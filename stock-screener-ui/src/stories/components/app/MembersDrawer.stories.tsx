import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { Button, Group, Stack, Text } from "@/ui";
import { MembersDrawer, type MembersDrawerTestIds } from "@/components/common/MembersDrawer";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack, Specimen } from "./StoryFrame";

const MEMBERS = [
  "NIFTY",
  "BANKNIFTY",
  "RELIANCE",
  "HDFCBANK",
  "ICICIBANK",
  "TCS",
  "INFY",
  "SBIN",
] as const;

const IDS: MembersDrawerTestIds = {
  drawer: "story-members-drawer",
  close: "story-members-close",
  search: "story-members-search",
  error: "story-members-error",
  row: (symbol) => `story-members-row-${symbol}`,
  tv: (symbol) => `story-members-tv-${symbol}`,
  chart: (symbol) => `story-members-chart-${symbol}`,
};

type DrawerArgs = {
  state: "populated" | "loading" | "empty" | "error";
  query: string;
};

const meta: Meta<DrawerArgs> = {
  title: "App/Components/MembersDrawer",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The shared right-edge members drawer from src/components/common/MembersDrawer.tsx. " +
          "The caller owns filtering and fetch state; the drawer only renders what it is given. " +
          "Each row links to TradingView and to the in-app chart. Loading, empty and error are " +
          "distinct states, so a failed request never reads as an empty watchlist.",
      },
    },
  },
  args: { state: "populated", query: "" },
  argTypes: {
    state: {
      control: "inline-radio",
      options: ["populated", "loading", "empty", "error"],
      description: "Which caller-supplied result state the drawer renders.",
    },
    query: { control: "text", description: "Initial filter text; the drawer filters the list it receives." },
  },
};
export default meta;
type Story = StoryObj<DrawerArgs>;

const renderDrawer = (args: DrawerArgs) =>
  solidStory(() => {
    const [open, setOpen] = createSignal(true);
    const [query, setQuery] = createSignal(args.query);
    const matches = () =>
      MEMBERS.filter((symbol) => symbol.toLowerCase().includes(query().trim().toLowerCase()));
    const shown = () => (args.state === "populated" ? [...matches()] : []);
    const error = () =>
      args.state === "error" ? "Couldn't load the watchlist. Check your connection and try again." : null;

    return (
      <>
        <DemoStack>
          <DemoPanel
            title="Members drawer · index watchlist"
            detail="Filter a constituent list, then open a member's chart or TradingView page."
            meta="8 NSE constituents"
            testId="story-members-drawer-frame"
          >
            <Stack gap="sm">
              <Specimen
                label="Caller-owned list"
                detail="The story filters a fixed constituent list; the drawer renders the result."
              >
                <Group gap="sm" wrap="wrap">
                  <Button size="sm" onClick={() => setOpen(true)}>Open members drawer</Button>
                  <Text size="xs" c="dimmed">
                    {matches().length} of {MEMBERS.length} members match the current filter.
                  </Text>
                </Group>
              </Specimen>
            </Stack>
          </DemoPanel>
        </DemoStack>
        <MembersDrawer
          open={open()}
          onClose={() => setOpen(false)}
          title="NIFTY 50 members"
          subtitle="Index constituents · NSE"
          description="Prices refresh during market hours. Pick a member to open its chart."
          symbols={shown()}
          loading={args.state === "loading"}
          error={error()}
          emptyNote="No members in this watchlist"
          query={query()}
          onQueryChange={(value) => setQuery(value)}
          searchPlaceholder="Filter members"
          closeLabel="Close members drawer"
          ids={IDS}
          width={360}
          gridMin={132}
          footerLeft={<Text size="xs" c="dimmed">{`${shown().length} members shown`}</Text>}
          footerRight={<Text size="xs" c="dimmed">NSE · equities</Text>}
        />
      </>
    );
  });

export const Populated: Story = {
  render: (args) => renderDrawer({ ...args, state: "populated" }),
};

/** A slow request keeps the spinner visible instead of flashing an empty list. */
export const Loading: Story = {
  render: (args) => renderDrawer({ ...args, state: "loading" }),
};

/** A filter with no hits uses the caller's empty copy. */
export const NoMatches: Story = {
  render: (args) => renderDrawer({ ...args, state: "empty", query: "ADANI" }),
};

/** A failed request is an error, not an empty watchlist. */
export const LoadError: Story = {
  render: (args) => renderDrawer({ ...args, state: "error" }),
};
