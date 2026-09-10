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
          "Settings — broker connection card + market ticker toggle and account prefs from `pages/settings/SettingsPage.tsx`. Use to connect OAuth broker and toggle UI prefs at /settings. When not: for strategy tuning use Strategy Lab at /backtest.",
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
