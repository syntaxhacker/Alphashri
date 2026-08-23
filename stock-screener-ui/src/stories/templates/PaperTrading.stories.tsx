import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import { Box } from "@/ui";
import { PaperTradingView } from "@/components/paper-trading/PaperTradingView2";
import { setPositions, setPortfolio, setSelectedSymbol, setChartData, setBotSnapshot, setAvailableBots, setPaperTradingView, resetPaperTradingState } from "@/state/paperTrading";
import { MOCK_PAPER_POSITIONS, MOCK_PAPER_PORTFOLIO, MOCK_PAPER_ORB, MOCK_PAPER_PIVOT, MOCK_PAPER_52W, MOCK_PAPER_EMA, MOCK_PAPER_BARE } from "../fixtures";

const mockBots: any[] = [{ id: "bot-1", name: "ORB Best — Paper", strategies: [{ id: "s1", name: "ORB Best", strategy_type: "ORB" }], is_active: true, live_trading: false, running: true, pid: 1234, position_count: 2 }];

const CHART_BY_STRATEGY: Record<string, any> = {
  live: MOCK_PAPER_ORB,
  orb: MOCK_PAPER_ORB,
  pivot: MOCK_PAPER_PIVOT,
  "52w": MOCK_PAPER_52W,
  ema: MOCK_PAPER_EMA,
  bare: MOCK_PAPER_BARE,
};

function MockSetup({ children, empty, view, chartKey }: { children: React.ReactNode; empty?: boolean; view?: string; chartKey?: string }) {
  useEffect(() => {
    resetPaperTradingState();
    if (empty) {
      setPositions([]);
      setPortfolio({ ...MOCK_PAPER_PORTFOLIO, positions: 0, open_positions: 0, unrealized_pnl: 0 } as any);
      setSelectedSymbol(null);
      setChartData(null);
      setBotSnapshot(null);
    } else {
      setPositions(MOCK_PAPER_POSITIONS as any);
      setPortfolio(MOCK_PAPER_PORTFOLIO as any);
      setSelectedSymbol("RELIANCE");
      setChartData((CHART_BY_STRATEGY[chartKey || view || "live"] || MOCK_PAPER_ORB) as any);
      setBotSnapshot({
        timestamp: new Date().toISOString(),
        watchlist: ["RELIANCE", "TCS", "INFY"],
        strategy_watchlists: { "1": ["RELIANCE", "TCS"] },
        open_positions: ["RELIANCE", "TCS"],
        scan_items: [
          { symbol: "RELIANCE", status: "signal", side: "LONG", price: 1428, or_high: 1422, or_low: 1410, reason: "Breakout", strategy_name: "ORB Best" },
          { symbol: "TCS", status: "watching", price: 3225, reason: "Inside OR", strategy_name: "ORB Best" },
        ],
        signals: [],
      } as any);
    }
    setAvailableBots(mockBots as any);
    setPaperTradingView((view as any) || "live");
    const origFetch = window.fetch;
    // @ts-ignore
    window.fetch = async (url: string, opts?: any) => {
      const s = String(url);
      if (s.includes("/api/bots")) return { ok: true, status: 200, json: async () => mockBots, text: async () => JSON.stringify(mockBots) } as Response;
      if (s.includes("/api/paper/portfolio")) return { ok: true, status: 200, json: async () => MOCK_PAPER_PORTFOLIO, text: async () => "{}" } as Response;
      if (s.includes("/api/paper/positions")) return { ok: true, status: 200, json: async () => ({ positions: MOCK_PAPER_POSITIONS, count: MOCK_PAPER_POSITIONS.length }), text: async () => "{}" } as Response;
      if (s.includes("/api/paper/chart")) {
        const key = (CHART_BY_STRATEGY[chartKey || "live"] || MOCK_PAPER_ORB) as any;
        return { ok: true, status: 200, json: async () => key, text: async () => "{}" } as Response;
      }
      if (s.includes("market-ticker")) return { ok: true, status: 200, json: async () => ({ tickers: {} }), text: async () => "{}" } as Response;
      return origFetch(url, opts);
    };
    return () => { // @ts-ignore
      window.fetch = origFetch; resetPaperTradingState();
    };
  }, [empty, view, chartKey]);
  return <>{children}</>;
}

const meta: Meta = {
  title: "Templates/Paper Trading",
  tags: ["autodocs"],
  parameters: { layout: "fullscreen", docs: { description: { component: "Paper Trading — exact `PaperTradingView`. Use the per-strategy stories to QA one overlay at a time (decoupled for Chromatic)." } } },
};
export default meta;
export const LiveOrb: StoryObj = { name: "ORB — blue box (Paper ORB)", decorators: [(Story: any) => <MockSetup view="live" chartKey="orb"><Story /></MockSetup>], render: () => <MemoryRouter initialEntries={["/paper"]}><Box p="xs" h="100vh" style={{ overflow: "hidden" }}><PaperTradingView /></Box></MemoryRouter> };
export const LivePivot: StoryObj = { name: "S/R Pivots — PP/R1/S1 (SR Breakout)", decorators: [(Story: any) => <MockSetup view="live" chartKey="pivot"><Story /></MockSetup>], render: () => <MemoryRouter initialEntries={["/paper"]}><Box p="xs" h="100vh" style={{ overflow: "hidden" }}><PaperTradingView /></Box></MemoryRouter> };
export const Live52w: StoryObj = { name: "52W High — pink dashed (CHASER/TARGET)", decorators: [(Story: any) => <MockSetup view="live" chartKey="52w"><Story /></MockSetup>], render: () => <MemoryRouter initialEntries={["/paper"]}><Box p="xs" h="100vh" style={{ overflow: "hidden" }}><PaperTradingView /></Box></MemoryRouter> };
export const LiveEma: StoryObj = { name: "EMA 9/21 — ADX/Volume companion", decorators: [(Story: any) => <MockSetup view="live" chartKey="ema"><Story /></MockSetup>], render: () => <MemoryRouter initialEntries={["/paper"]}><Box p="xs" h="100vh" style={{ overflow: "hidden" }}><PaperTradingView /></Box></MemoryRouter> };
export const LiveBare: StoryObj = { name: "Bare — ADX / Volume Surge", decorators: [(Story: any) => <MockSetup view="live" chartKey="bare"><Story /></MockSetup>], render: () => <MemoryRouter initialEntries={["/paper"]}><Box p="xs" h="100vh" style={{ overflow: "hidden" }}><PaperTradingView /></Box></MemoryRouter> };
export const LiveEmpty: StoryObj = { name: "Live — empty (no positions)", decorators: [(Story: any) => <MockSetup empty view="live"><Story /></MockSetup>], render: () => <MemoryRouter initialEntries={["/paper"]}><Box p="xs" h="100vh" style={{ overflow: "hidden" }}><PaperTradingView /></Box></MemoryRouter> };
export const History: StoryObj = { name: "Trade History + chart", decorators: [(Story: any) => <MockSetup view="history"><Story /></MockSetup>], render: () => <MemoryRouter initialEntries={["/paper"]}><Box p="xs" h="100vh" style={{ overflow: "hidden" }}><PaperTradingView /></Box></MemoryRouter> };
export const Dashboard: StoryObj = { name: "Dashboard — aggregated", decorators: [(Story: any) => <MockSetup view="aggregated"><Story /></MockSetup>], render: () => <MemoryRouter initialEntries={["/paper"]}><Box p="xs" h="100vh" style={{ overflow: "hidden" }}><PaperTradingView /></Box></MemoryRouter> };
