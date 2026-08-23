import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import NewsPage from "@/pages/NewsPage";

const meta: Meta<typeof NewsPage> = {
  title: "Templates/News",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "News — exact `NewsPage` from `pages/NewsPage.tsx` with no mocks. " +
          "Renders the real list + article detail layout as used at `/news`. " +
          "Requires backend at `http://localhost:8765` for data; otherwise shows loading/empty states.",
      },
    },
  },
};
export default meta;

export const Default: StoryObj<typeof NewsPage> = {
  render: () => (
    <MemoryRouter initialEntries={["/news"]}>
      <NewsPage />
    </MemoryRouter>
  ),
};
