import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { SettingsPage } from "@/pages/settings/SettingsPage";

const meta: Meta<typeof SettingsPage> = {
  title: "Templates/Settings",
  component: SettingsPage,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Settings — exact `SettingsPage` from `pages/settings/SettingsPage.tsx` with no mocks. " +
          "Renders broker connection card + market ticker toggle as used at `/settings`. " +
          "Fetches real broker status from `GET /api/brokers/status` — shows loading/empty states when backend is unavailable.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof SettingsPage>;

export const Default: Story = {
  render: () => (
    <MemoryRouter initialEntries={["/settings"]}>
      <SettingsPage />
    </MemoryRouter>
  ),
};
