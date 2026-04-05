import type { SymbolChartData, ChartOptions } from "../../types/backtest";
import { chartTradesToTrades } from "../../api/chartBuilder";

export type BacktestStateGetter = () => {
  chartData: Map<string, SymbolChartData>;
  chartOptions: ChartOptions;
  tradeHistory: any;
  tradeHistorySymbol: string | null;
};

export type BacktestStateSetter = (patch: Record<string, any>) => void;

export function createChartActions(
  getState: BacktestStateGetter,
  setState: BacktestStateSetter,
) {
  function setShowCharts(show: boolean) {
    setState({ showCharts: show });
  }

  function setSelectedChartSymbol(symbol: string | null) {
    setState({ selectedChartSymbol: symbol });
  }

  function setChartDataBatch(dataMap: Record<string, SymbolChartData>) {
    const s = getState();
    const newChartData = new Map(s.chartData);
    for (const [symbol, data] of Object.entries(dataMap)) {
      newChartData.set(symbol, data);
    }
    setState({ chartData: newChartData, chartLoading: false });
  }

  function setChartData(symbol: string, data: SymbolChartData) {
    const s = getState();
    const newChartData = new Map(s.chartData);
    newChartData.set(symbol, data);

    let tradeHistory = s.tradeHistory;
    let tradeHistorySymbol = s.tradeHistorySymbol;
    if (data.trades && data.trades.length > 0) {
      tradeHistory = chartTradesToTrades(data.trades);
      tradeHistorySymbol = symbol;
    }

    setState({
      chartData: newChartData,
      chartLoading: false,
      tradeHistory,
      tradeHistorySymbol,
    });
  }

  function setChartLoading(loading: boolean) {
    setState({ chartLoading: loading });
  }

  function setChartOptions(options: Partial<ChartOptions>) {
    const s = getState();
    setState({ chartOptions: { ...s.chartOptions, ...options } });
  }

  return {
    setShowCharts,
    setSelectedChartSymbol,
    setChartDataBatch,
    setChartData,
    setChartLoading,
    setChartOptions,
  };
}
