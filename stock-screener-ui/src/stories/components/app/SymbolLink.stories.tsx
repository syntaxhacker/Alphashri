import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { Box, Stack, Text } from "@/ui";
import { SymbolLink } from "@/components/common/SymbolLink";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack, Specimen } from "./StoryFrame";

const FIXTURE_LABEL = "frozen symbol links · 2026-11-20 09:15 IST";

type SymbolLinkArgs = {
  symbol: string;
  inAppText: boolean;
  showCopy: boolean;
  showChart: boolean;
  showOptions: boolean;
  size: "xs" | "sm" | "md";
};

const meta: Meta<SymbolLinkArgs> = {
  title: "App/Components/SymbolLink",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The shared symbol affordance from src/components/common/SymbolLink.tsx. The symbol " +
          "text can be a TradingView link or an in-app button (`inAppText`); the trailing chart " +
          "and options buttons call the app-wide symbol dock. Outside the provider the dock is " +
          "inert, so this component renders safely in Storybook without a Router. " +
          "`ClickableSymbol` is intentionally not staged here: it calls `useNavigate()` and " +
          "requires a Router ancestor.",
      },
    },
  },
  args: {
    symbol: "NIFTY",
    inAppText: false,
    showCopy: false,
    showChart: true,
    showOptions: true,
    size: "sm",
  },
  argTypes: {
    symbol: { control: "text", description: "Displayed ticker; also drives the accessible action labels." },
    inAppText: { control: "boolean", description: "Make the symbol text the in-app action and move TV to the ↗ icon." },
    showCopy: { control: "boolean", description: "Show the clipboard action." },
    showChart: { control: "boolean", description: "Show the trailing in-app chart button." },
    showOptions: { control: "boolean", description: "Show the trailing options-chain button." },
    size: { control: "inline-radio", options: ["xs", "sm", "md"], description: "Text size token." },
  },
};
export default meta;
type Story = StoryObj<SymbolLinkArgs>;

/** A row strip mirrors the way symbol links sit in a screener table. */
const LinkRow = (props: { children: import("solid-js").JSX.Element }) => (
  <Box style={{ padding: "8px 16px", "background-color": "var(--color-fin-surface-alt)", "border-radius": "4px" }}>
    {props.children}
  </Box>
);

export const Playground: Story = {
  render: (args) =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Symbol link · playground"
          detail={FIXTURE_LABEL}
          meta={`${args.symbol} · size ${args.size}`}
          testId="story-symbol-playground-frame"
        >
          <LinkRow>
            <SymbolLink
              symbol={args.symbol}
              inAppText={args.inAppText}
              showCopy={args.showCopy}
              showChart={args.showChart}
              showOptions={args.showOptions}
              size={args.size}
              ariaLabel={`Open ${args.symbol} details`}
              testId="story-symbol-playground"
            />
          </LinkRow>
        </DemoPanel>
      </DemoStack>
    )),
};

/** Explicit in-app handler keeps all actions local and observable. */
export const ActionVariations: Story = {
  render: () =>
    solidStory(() => {
      const [last, setLast] = createSignal("none");
      const act = (action: string) => (symbol: string) => setLast(`${action}:${symbol}`);
      return (
        <DemoStack>
          <DemoPanel
            title="Symbol link · action variations"
            detail={`${FIXTURE_LABEL} · local symbol actions`}
            metaNode={<Text size="xs" c="secondary" aria-live="polite">{last() === "none" ? "No symbol action yet" : `${last()} · handled locally`}</Text>}
            testId="story-symbol-actions-frame"
          >
            <Specimen label="Local handlers" detail="Actions stay local; the app-wide dock is inert in Storybook.">
              <Stack gap="xs">
                <LinkRow><SymbolLink symbol="NIFTY" onOpen={act("chart")} testId="story-symbol-chart" /></LinkRow>
                <LinkRow><SymbolLink symbol="RELIANCE" onOpen={act("chart")} showCopy testId="story-symbol-copy" /></LinkRow>
                <LinkRow>
                  <SymbolLink
                    symbol="TCS"
                    inAppText
                    onOpen={act("in-app")}
                    onTextClick={act("text")}
                    ariaLabel="Open TCS chart in app"
                    testId="story-symbol-inapp"
                  />
                </LinkRow>
                <LinkRow>
                  <SymbolLink
                    symbol="AAPL"
                    market="NASDAQ"
                    tvLink={false}
                    showChart={false}
                    showOptions={false}
                    onTextClick={act("tv-off")}
                    secondary={<Text size="xs" c="secondary" span>Apple Inc.</Text>}
                    testId="story-symbol-secondary"
                  />
                </LinkRow>
              </Stack>
            </Specimen>
          </DemoPanel>
        </DemoStack>
      );
    }),
};

export const TvVariations: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Symbol link · TradingView variants"
          detail={`${FIXTURE_LABEL} · external link variants (hrefs only, no fetch)`}
          meta="4 href-only variants"
          testId="story-symbol-tv-frame"
        >
          <Stack gap="xs">
            <LinkRow><SymbolLink symbol="NIFTY" tvLink tvIcon showChart={false} showOptions={false} testId="story-symbol-tv" /></LinkRow>
            <LinkRow><SymbolLink symbol="AAPL" market="NASDAQ" tvLink tvIcon showChart={false} showOptions={false} testId="story-symbol-tv-us" /></LinkRow>
            <LinkRow><SymbolLink symbol="BRK.B" tvSymbol="NYSE:BRK.B" tvLink tvIcon showChart={false} showOptions={false} testId="story-symbol-tv-override" /></LinkRow>
            <LinkRow><SymbolLink symbol="NIFTY" tvLink={false} showChart={false} showOptions={false} testId="story-symbol-plain" /></LinkRow>
          </Stack>
        </DemoPanel>
      </DemoStack>
    )),
};
