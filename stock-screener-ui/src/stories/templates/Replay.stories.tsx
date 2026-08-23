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
          "Replay Trading Day — exact `ReplayPage` from `components/replay/ReplayPage.tsx` with no mocks. " +
          "Renders the real component (ConfigBar → Stats → Positions → MainView → Summary) as used at `/replay`. " +
          "Requires backend at `http://localhost:8765` for data; otherwise shows natural loading/empty states.",
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
