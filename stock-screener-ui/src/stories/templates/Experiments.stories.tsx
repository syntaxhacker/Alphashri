import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { ExperimentsPage } from "@/components/experiments/ExperimentsPage";

const meta: Meta<typeof ExperimentsPage> = {
  title: "Templates/Experiments",
  component: ExperimentsPage,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Experiments Lab — strategy config + backtest sessions + progress and results chart from `components/experiments/ExperimentsPage.tsx`. Use to run and compare backtests at /experiments. When not: for live/paper positions use Paper Trading at /paper.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof ExperimentsPage>;

export const Default: Story = {
  render: () => (
    <MemoryRouter initialEntries={["/experiments"]}>
      <ExperimentsPage />
    </MemoryRouter>
  ),
};
