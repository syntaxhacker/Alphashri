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
          "News — curated feed + article detail with sentiment and symbol tags from `pages/NewsPage.tsx`. Use to browse market news and linked tickers at /news. When not: for price action and levels use Chart at /chart/:symbol.",
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
