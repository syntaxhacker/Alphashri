import type { Meta, StoryObj } from "@storybook/react";
import { StockRow } from "./StockRow";
import type { Stock } from "../../types";
import type { ColumnDef } from "./columns";

const columns: ColumnDef[] = [
  { key: "symbol", label: "Symbol", type: "string", sortable: true },
  { key: "score", label: "Score", type: "number", sortable: true },
  { key: "tv_price", label: "Price", type: "number", sortable: true },
  { key: "to_52w_high", label: "To 52W High", type: "number", sortable: true },
  { key: "recent_return_5d", label: "Return 5D", type: "number", sortable: true },
  { key: "perf_w", label: "Perf W", type: "number", sortable: true },
  { key: "sector", label: "Sector", type: "string", sortable: true },
];

const basicStock: Stock = {
  symbol: "RELIANCE",
  score: 85,
  tv_price: 2450.0,
  upstox_price: 2452.0,
  broker_diff: 0.08,
  high_52w: 2800.0,
  to_52w_high: -12.5,
  recent_return_5d: 3.2,
  perf_w: 5.8,
  sector: "Energy",
  touched_52w: true,
};

const fullDataStock: Stock = {
  symbol: "TCS",
  score: 72,
  tv_price: 3850.0,
  upstox_price: 3848.0,
  broker_diff: -0.05,
  high_52w: 4200.0,
  to_52w_high: -8.3,
  recent_return_5d: 1.5,
  perf_w: 2.1,
  sector: "IT",
  touched_52w: false,
  day_change: 2.5,
  rsi: 65,
  stoch_k: 78,
  wick_close_pct: 0.5,
  volume_surge: 1.8,
  atr_pct: 1.2,
  adx: 25,
  interest_score: 8,
  gap_pct: 0.3,
  premarket_change: 0.5,
  impact_score: 7,
  market_cap_b: 450,
  volume_m: 2.5,
  reversal_signal: "BULLISH",
  rationale: "Strong momentum with volume surge",
  is_bullish: true,
  sentiment: "bullish",
};

const negativeStock: Stock = {
  symbol: "INFY",
  score: 35,
  tv_price: 1520.0,
  upstox_price: 1522.0,
  broker_diff: 0.13,
  high_52w: 1750.0,
  to_52w_high: -13.1,
  recent_return_5d: -2.8,
  perf_w: -4.5,
  sector: "IT",
  touched_52w: false,
  rsi: 32,
  stoch_k: 18,
  sentiment: "bearish",
};

const meta: Meta<typeof StockRow> = {
  title: "Design System/Screener/StockRow",
  component: StockRow,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  argTypes: {
    isTouched: {
      control: "boolean",
    },
  },
};

export default meta;
type Story = StoryObj<typeof StockRow>;

export const Default: Story = {
  args: {
    stock: basicStock,
    columns: columns,
    isTouched: false,
    onSymbolClick: (symbol: string) => console.log("Clicked:", symbol),
    onSymbolHover: (symbol: string | null) => console.log("Hovered:", symbol),
  },
};

export const WithFullData: Story = {
  args: {
    stock: fullDataStock,
    columns: columns,
    isTouched: false,
    onSymbolClick: (symbol: string) => console.log("Clicked:", symbol),
    onSymbolHover: (symbol: string | null) => console.log("Hovered:", symbol),
  },
};

export const Touched: Story = {
  args: {
    stock: basicStock,
    columns: columns,
    isTouched: true,
    onSymbolClick: (symbol: string) => console.log("Clicked:", symbol),
    onSymbolHover: (symbol: string | null) => console.log("Hovered:", symbol),
  },
};

export const NegativePerformance: Story = {
  args: {
    stock: negativeStock,
    columns: columns,
    isTouched: false,
    onSymbolClick: (symbol: string) => console.log("Clicked:", symbol),
    onSymbolHover: (symbol: string | null) => console.log("Hovered:", symbol),
  },
};
