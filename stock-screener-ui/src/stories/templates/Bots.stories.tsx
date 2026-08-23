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
          "Bots — exact `BotsPage` from `components/bots/BotsPage.tsx` with no mocks. " +
          "Reads from `BotsState` store (no props). Renders bot list tabs, table, and status panels as used at `/bots`. " +
          "Requires backend at `http://localhost:8765` for data; otherwise shows the component's natural loading/empty states.",
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
