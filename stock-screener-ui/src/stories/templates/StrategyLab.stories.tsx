import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { BacktestPage } from "@/components/backtest/BacktestPage";
import { MOCK_BACKTEST_RESULTS } from "../fixtures";
import { setResults, setStrategies, setVariations, resetBacktestState } from "@/state/backtest";

const mockStrategies = [{ id: "orb", name: "ORB Best", description: "Opening range breakout", params: [] }];
const mockVariations = [{ id: "v1", internal_id: 1, name: "ORB Default", strategy_type: "orb", description: "Default ORB", is_template: false, is_default: true }];

function withMock(Story: React.FC, empty?: boolean) {
  return function Wrapper() {
    useEffect(() => {
      const orig = window.fetch;
      // @ts-ignore
      window.fetch = async (url: string, opts?: any) => {
        const s = String(url);
        if (s.includes("/api/backtest/strategies")) return { ok: true, status: 200, json: async () => ({ strategies: empty ? [] : mockStrategies }), text: async () => "{}" } as Response;
        if (s.includes("/api/strategies/variations")) return { ok: true, status: 200, json: async () => (empty ? [] : mockVariations), text: async () => "{}" } as Response;
        if (s.includes("/api/backtest/costs")) return { ok: true, status: 200, json: async () => ({ costs: {} }), text: async () => "{}" } as Response;
        if (s.includes("/api/backtest/run")) return { ok: true, status: 200, json: async () => ({ strategy: "orb", config: {}, results: empty ? [] : MOCK_BACKTEST_RESULTS, totals: { trades: 21, gross_pnl: 5000, total_costs: 730, net_pnl: 4270, win_rate: 57 } }), text: async () => "{}" } as Response;
        return orig(url, opts);
      };
      if (!empty) { setStrategies(mockStrategies as any); setVariations(mockVariations as any); setResults(MOCK_BACKTEST_RESULTS as any, { trades: 21, gross_pnl: 5000, total_costs: 730, net_pnl: 4270, win_rate: 57 } as any); }
      else resetBacktestState();
      return () => { window.fetch = orig; resetBacktestState(); };
    }, []);
    return <Story />;
  };
}

const meta: Meta = {
  title: "Templates/Strategy Lab",
  tags: ["autodocs"],
  parameters: { layout: "fullscreen", docs: { description: { component: "Strategy Lab — exact `BacktestPage` with mocked `/api/backtest/strategies`, `/api/strategies/variations`, `/api/backtest/run` returning `MOCK_BACKTEST_RESULTS` from `fixtures.ts`. Default is populated; Empty shows no results." } } },
};
export default meta;

export const Default: StoryObj = { decorators: [(Story: any) => { const W = withMock(Story, false); return <W />; }], render: () => <BacktestPage /> };
export const Empty: StoryObj = { decorators: [(Story: any) => { const W = withMock(Story, true); return <W />; }], render: () => <BacktestPage /> };
