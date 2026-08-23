import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ChartView from "../../pages/chart/ChartView";
import {
  MOCK_CHART_DATA,
  MOCK_ORB_CHART,
  MOCK_PIVOT_CHART,
  MOCK_52W_CHART,
  MOCK_EMA_CHART,
  MOCK_BARE_CHART,
} from "../fixtures";

function withChartMock(data: any) {
  return (Story: React.FC) => {
    const orig = window.fetch;
    // @ts-ignore
    window.fetch = async (url: string, opts?: any) => {
      if (String(url).includes("/api/chart/preview") || String(url).includes("/api/paper/chart")) {
        return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) } as Response;
      }
      return orig(url, opts);
    };
    return <Story />;
  };
}

const meta: Meta<typeof ChartView> = {
  title: "Templates/Chart",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Chart — single-stock ECharts view with OR zones, pivot levels, 52W high, EMA and timeframe controls from `pages/chart/ChartView.tsx`. Use for deep dive on one symbol at /chart/:symbol. When not: for universe scan use Stock Screener at / or Heatmap at /heatmap.",
      },
    },
  },
};
export default meta;

export const Default: StoryObj = {
  name: "Default — all overlays (bundled)",
  decorators: [withChartMock(MOCK_CHART_DATA)],
  render: () => (
    <MemoryRouter initialEntries={["/chart/RELIANCE"]}>
      <Routes><Route path="/chart/:symbol" element={<ChartView />} /></Routes>
    </MemoryRouter>
  ),
};

export const OrbOnly: StoryObj = {
  name: "ORB only — 1422 / 1410 box",
  decorators: [withChartMock(MOCK_ORB_CHART)],
  render: () => (
    <MemoryRouter initialEntries={["/chart/RELIANCE"]}>
      <Routes><Route path="/chart/:symbol" element={<ChartView />} /></Routes>
    </MemoryRouter>
  ),
};

export const PivotsOnly: StoryObj = {
  name: "S/R Pivots only — PP/R1/S1",
  decorators: [withChartMock(MOCK_PIVOT_CHART)],
  render: () => (
    <MemoryRouter initialEntries={["/chart/RELIANCE"]}>
      <Routes><Route path="/chart/:symbol" element={<ChartView />} /></Routes>
    </MemoryRouter>
  ),
};

export const High52wOnly: StoryObj = {
  name: "52W High only — 1605 dashed",
  decorators: [withChartMock(MOCK_52W_CHART)],
  render: () => (
    <MemoryRouter initialEntries={["/chart/RELIANCE"]}>
      <Routes><Route path="/chart/:symbol" element={<ChartView />} /></Routes>
    </MemoryRouter>
  ),
};

export const EmaOnly: StoryObj = {
  name: "EMA Cross only — 9/21 lines",
  decorators: [withChartMock(MOCK_EMA_CHART)],
  render: () => (
    <MemoryRouter initialEntries={["/chart/RELIANCE"]}>
      <Routes><Route path="/chart/:symbol" element={<ChartView />} /></Routes>
    </MemoryRouter>
  ),
};

export const BareCandles: StoryObj = {
  name: "Bare — ADX / Volume Surge (no overlay)",
  decorators: [withChartMock(MOCK_BARE_CHART)],
  render: () => (
    <MemoryRouter initialEntries={["/chart/RELIANCE"]}>
      <Routes><Route path="/chart/:symbol" element={<ChartView />} /></Routes>
    </MemoryRouter>
  ),
};

export const ChartEmpty: StoryObj = {
  render: () => (
    <MemoryRouter initialEntries={["/chart"]}>
      <Routes><Route path="/chart" element={<ChartView />} /><Route path="/chart/:symbol" element={<ChartView />} /></Routes>
    </MemoryRouter>
  ),
};
