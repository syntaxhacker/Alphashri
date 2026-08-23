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
          "Experiments Lab — exact `ExperimentsPage` from `components/experiments/ExperimentsPage.tsx` with no mocks. " +
          "Renders the real component (Config → Sessions → Progress → Results → Chart) as used at `/experiments`. " +
          "Requires backend at `http://localhost:8765` for data; otherwise shows natural loading/empty states.",
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
