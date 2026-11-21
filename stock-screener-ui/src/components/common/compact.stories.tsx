import type { Meta, StoryObj } from "@storybook/html-vite";
import { solidStory } from "@/stories/solidStory";
import { CompactPanel, CompactStat, CompactStatGrid } from "./compact";

const meta: Meta = { title: "Terminal/Panels", tags: ["autodocs"] };
export default meta;

type Story = StoryObj;

export const Panel: Story = {
  render: () =>
    solidStory(() => (
      <div style={{ width: "420px" }}>
        <CompactPanel title="ORDER BOOK" description="NIFTY 5,842 · nearest expiry">
          <div style={{ padding: "4px 8px", "font-size": "11px" }}>458 rows · 12:03:15 IST</div>
        </CompactPanel>
      </div>
    )),
};

export const Stats: Story = {
  render: () =>
    solidStory(() => (
      <div style={{ width: "720px" }}>
        <CompactStatGrid>
          <CompactStat label="Spot" value="5,842.31" hint="+18.42" />
          <CompactStat label="PCR (OI)" value="1.12" tone="success" />
          <CompactStat label="Max Pain" value="5,800" />
          <CompactStat label="Pin Risk" value="HIGH" tone="warning" />
        </CompactStatGrid>
      </div>
    )),
};
