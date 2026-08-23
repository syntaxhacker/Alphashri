import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { BotsPage } from "@/components/bots/BotsPage";

const meta: Meta<typeof BotsPage> = {
  title: "Templates/Bots",
  component: BotsPage,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Bots — bot list tabs, config table, and live status panels from `components/bots/BotsPage.tsx`. Use to manage and monitor trading bots at /bots. When not: for trade execution and history use Paper Trading at /paper.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof BotsPage>;

export const Default: Story = {
  render: () => (
    <MemoryRouter initialEntries={["/bots"]}>
      <BotsPage />
    </MemoryRouter>
  ),
};
