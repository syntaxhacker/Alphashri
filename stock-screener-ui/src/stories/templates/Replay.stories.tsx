import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { ReplayPage } from "@/components/replay/ReplayPage";

const meta: Meta<typeof ReplayPage> = {
  title: "Templates/Replay",
  component: ReplayPage,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Replay Trading Day — ConfigBar → Stats → Positions → MainView replay of a historical session from `components/replay/ReplayPage.tsx`. Use to step through and audit a trading day at /replay. When not: for live trading use Paper Trading at /paper.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof ReplayPage>;

export const Default: Story = {
  render: () => (
    <MemoryRouter initialEntries={["/replay"]}>
      <ReplayPage />
    </MemoryRouter>
  ),
};
