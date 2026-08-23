import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { HeatmapPage } from "../../pages/heatmap/HeatmapPage";
import { MOCK_HEATMAP_RESPONSE, MOCK_SECTORS_RESPONSE } from "../fixtures";

function withHeatmapMock(Story: React.FC) {
  const orig = window.fetch;
  // @ts-ignore
  window.fetch = async (url: string, opts?: any) => {
    const s = String(url);
    if (s.includes("/api/heatmap/pe")) return { ok: true, status: 200, json: async () => MOCK_HEATMAP_RESPONSE } as Response;
    if (s.includes("/api/heatmap/sectors")) return { ok: true, status: 200, json: async () => MOCK_SECTORS_RESPONSE } as Response;
    return orig(url, opts);
  };
  return <Story />;
}

const meta: Meta<typeof HeatmapPage> = {
  title: "Templates/Heatmap",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Heatmap — exact HeatmapPage from pages/heatmap/HeatmapPage.tsx as used at /heatmap. Shows NSE 500 treemap/list/scatter.",
      },
    },
  },
};
export default meta;

export const Default: StoryObj = {
  decorators: [withHeatmapMock],
  render: () => (
    <MemoryRouter initialEntries={["/heatmap"]}>
      <HeatmapPage />
    </MemoryRouter>
  ),
};
