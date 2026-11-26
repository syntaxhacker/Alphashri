import type { Meta, StoryObj } from "@storybook/html-vite";
import { Box } from "@/ui";
import { BrokerAuthNotice } from "@/components/common/BrokerAuthNotice";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack, Specimen } from "./StoryFrame";

type NoticeArgs = {
  size: "xs" | "sm";
};

const meta: Meta<NoticeArgs> = {
  title: "Design System/Components/App/BrokerAuthNotice",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The broker reconnect notice from src/components/common/BrokerAuthNotice.tsx. It is a single " +
          "warning Alert with an icon, title, description and an `action` link. Options and broker " +
          "panels show it only when the typed API error kind is `auth` or `unauthorized`; a 500 or a " +
          "stale connection flag never produces this copy. The action opens Settings.",
      },
    },
  },
  args: { size: "xs" },
  argTypes: {
    size: { control: "inline-radio", options: ["xs", "sm"], description: "Text size used on the dense and roomy surfaces." },
  },
};
export default meta;
type Story = StoryObj<NoticeArgs>;

const renderNotice = (args: NoticeArgs, detail: string) =>
  solidStory(() => (
    <DemoStack>
      <DemoPanel
        title="Broker connection · reconnect prompt"
        detail={detail}
        meta="Settings link"
        testId="story-broker-auth-frame"
      >
        <Specimen label="Typed auth-error state" detail="Shown by options panels after a broker 401.">
          <Box style={{ "max-width": "560px", padding: "12px 16px", "background-color": "var(--color-fin-surface-alt)" }}>
            <BrokerAuthNotice size={args.size} connectTestId="story-broker-auth-connect" />
          </Box>
        </Specimen>
      </DemoPanel>
    </DemoStack>
  ));

/** Compact variant used by dense option-chain toolbars. */
export const Default: Story = {
  render: (args) => renderNotice(args, "The compact warning alert sits inline above an option chain."),
};

/** Roomier variant for a panel that has space for a full sentence. */
export const Roomy: Story = {
  render: (args) => renderNotice({ ...args, size: "sm" }, "The same warning alert at the larger text size."),
};

/** Both dense and roomy tiers side by side for a direct comparison. */
export const BothSizes: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Broker connection · both sizes"
          detail="One warning alert, two text tiers: the Settings action stays outside the description."
          meta="xs / sm"
          testId="story-broker-auth-sizes"
        >
          <Specimen label="xs" detail="Dense option-chain and analytics toolbars.">
            <Box style={{ "max-width": "560px", padding: "12px 16px", "background-color": "var(--color-fin-surface-alt)" }}>
              <BrokerAuthNotice size="xs" connectTestId="story-broker-auth-connect-xs" />
            </Box>
          </Specimen>
          <Specimen label="sm" detail="Panels with room for a full sentence.">
            <Box style={{ "max-width": "560px", padding: "12px 16px", "background-color": "var(--color-fin-surface-alt)" }}>
              <BrokerAuthNotice size="sm" connectTestId="story-broker-auth-connect-sm" />
            </Box>
          </Specimen>
        </DemoPanel>
      </DemoStack>
    )),
};
