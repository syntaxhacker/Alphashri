import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { ScreenerContainer } from "@/pages/screener/ScreenerContainer";
import { MOCK_SECTOR_STOCKS } from "../fixtures";
import type { Stock } from "@/types";

function toStock(s: (typeof MOCK_SECTOR_STOCKS)[number], i: number): Stock {
  const high = 1200 + i * 37;
  const price = +(high * 0.92).toFixed(2);
  return {
    symbol: `${s.symbol}${i >= 20 ? `_${i}` : ""}`,
    score: 95 - i, tv_price: price, upstox_price: price, broker_diff: 0,
    high_52w: high, to_52w_high: -8, recent_return_5d: s.change_pct,
    perf_w: s.change_pct, sector: s.sector, touched_52w: false, days_ago: null, day_change: s.change_pct,
  } as Stock;
}
const STOCKS: Stock[] = Array.from({ length: 50 }, (_, i) => toStock(MOCK_SECTOR_STOCKS[i % 20], i));

const mockScreenerData = {
  approaching: STOCKS.slice(0, 30), touched: STOCKS.slice(30),
  last_updated: new Date().toISOString(), provider: "upstox", mode: "intraday", screener: "trending",
};
const mockScreeners = { screeners: [{ id: "trending", label: "Trending", description: "Balanced trend + momentum" }], default: "trending" };

function withPopulated(Story: React.FC) {
  const orig = window.fetch;
  // @ts-ignore
  window.fetch = async (url: string, opts?: any) => {
    const s = String(url);
    if (s.includes("/api/screener")) return { ok: true, status: 200, json: async () => mockScreenerData, text: async () => JSON.stringify(mockScreenerData) } as Response;
    if (s.includes("/api/screeners")) return { ok: true, status: 200, json: async () => mockScreeners, text: async () => JSON.stringify(mockScreeners) } as Response;
    return orig(url, opts);
  };
  return <Story />;
}
function withEmpty(Story: React.FC) {
  const orig = window.fetch;
  // @ts-ignore
  window.fetch = async (url: string, opts?: any) => {
    const s = String(url);
    if (s.includes("/api/screener")) return { ok: true, status: 200, json: async () => ({ approaching: [], touched: [], last_updated: new Date().toISOString(), provider: "upstox", mode: "intraday", screener: "trending" }), text: async () => "{}" } as Response;
    if (s.includes("/api/screeners")) return { ok: true, status: 200, json: async () => mockScreeners, text: async () => JSON.stringify(mockScreeners) } as Response;
    return orig(url, opts);
  };
  return <Story />;
}

const meta: Meta<typeof ScreenerContainer> = {
  title: "Templates/Stock Screener",
  component: ScreenerContainer,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen", docs: { description: { component: "ScreenerContainer — exact container from `pages/screener/ScreenerContainer.tsx` with mocked fetch for `/api/screener?provider=upstox&mode=intraday&screener=trending` returning 50 stocks from `MOCK_SECTOR_STOCKS` via `fixtures.ts`. Shows populated table/heatmap. Empty shows no stocks." } } },
};
export default meta;

export const Default: StoryObj<typeof ScreenerContainer> = {
  decorators: [withPopulated, (Story) => <MemoryRouter><Story /></MemoryRouter>],
  render: () => <ScreenerContainer />,
};
export const Empty: StoryObj<typeof ScreenerContainer> = {
  decorators: [withEmpty, (Story) => <MemoryRouter><Story /></MemoryRouter>],
  render: () => <ScreenerContainer />,
};
