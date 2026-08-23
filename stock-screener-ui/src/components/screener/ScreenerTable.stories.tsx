import type { Meta, StoryObj } from "@storybook/react";
import { ScreenerTable } from "./ScreenerTable";
import { ScreenerLoading } from "./ScreenerLoading";
import type { Stock } from "../../types";
import type { ColumnDef } from "./columns";

const sampleColumns: ColumnDef[] = [
  { key: "symbol", label: "Symbol", type: "string", sortable: true },
  { key: "score", label: "Score", type: "number", sortable: true },
  { key: "tv_price", label: "Price", type: "number", sortable: true },
  { key: "to_52w_high", label: "To 52W High", type: "number", sortable: true },
  { key: "recent_return_5d", label: "Return 5D", type: "number", sortable: true },
  { key: "perf_w", label: "Perf W", type: "number", sortable: true },
  { key: "sector", label: "Sector", type: "string", sortable: true },
];

const sampleStocks: Stock[] = [
  {
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
  },
  {
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
  },
  {
    symbol: "INFY",
    score: 68,
    tv_price: 1520.0,
    upstox_price: 1522.0,
    broker_diff: 0.13,
    high_52w: 1750.0,
    to_52w_high: -13.1,
    recent_return_5d: -0.8,
    perf_w: -1.2,
    sector: "IT",
    touched_52w: true,
  },
  {
    symbol: "HDFCBANK",
    score: 55,
    tv_price: 1680.0,
    upstox_price: 1680.0,
    broker_diff: 0.0,
    high_52w: 1900.0,
    to_52w_high: -11.6,
    recent_return_5d: 0.5,
    perf_w: 1.8,
    sector: "Finance",
    touched_52w: false,
  },
  {
    symbol: "ITC",
    score: 42,
    tv_price: 420.0,
    upstox_price: 418.0,
    broker_diff: -0.48,
    high_52w: 500.0,
    to_52w_high: -16.0,
    recent_return_5d: -2.1,
    perf_w: -3.5,
    sector: "FMCG",
    touched_52w: false,
  },
];

const meta: Meta<typeof ScreenerTable> = {
  title: "Examples/Screener/Table",
  component: ScreenerTable,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof ScreenerTable>;

export const Empty: Story = {
  args: {
    stocks: [],
    columns: sampleColumns,
    touchedSymbols: new Set(),
    onSymbolClick: () => {},
    onSymbolHover: () => {},
  },
};

export const Loading: Story = {
  render: () => <ScreenerLoading message="Loading stocks..." />,
};

export const WithData: Story = {
  args: {
    stocks: sampleStocks,
    columns: sampleColumns,
    touchedSymbols: new Set(["RELIANCE", "INFY"]),
    onSymbolClick: () => {},
    onSymbolHover: () => {},
  },
};

// NOTE: ScreenerTable sorting is client-side via TanStackTable (enableSorting + column.sortable).
// There are no sortColumn/sortDirection props — users sort by clicking column headers.
// These stories demonstrate the gap by pre-sorting data so visual order is distinct.

const sortedByScoreDesc = [...sampleStocks].sort((a, b) => b.score - a.score);
const sortedByScoreAsc = [...sampleStocks].sort((a, b) => a.score - b.score);

export const SortedByScore: Story = {
  args: {
    stocks: sortedByScoreDesc,
    columns: sampleColumns,
    touchedSymbols: new Set(),
    onSymbolClick: () => {},
    onSymbolHover: () => {},
  },
  parameters: {
    docs: { description: { story: "Pre-sorted descending by score (highest first) — click Score header to toggle in the live table." } },
  },
};

export const SortedAscending: Story = {
  args: {
    stocks: sortedByScoreAsc,
    columns: sampleColumns,
    touchedSymbols: new Set(),
    onSymbolClick: () => {},
    onSymbolHover: () => {},
  },
  parameters: {
    docs: { description: { story: "Pre-sorted ascending by score (lowest first) — opposite order to SortedByScore to prove sort is observable." } },
  },
};

// Deduplicated: previous `EmptyState` (ScreenerEmpty standalone) removed — `Empty` already covers the empty table state.
// To demo the standalone empty illustration, render <ScreenerEmpty> directly in docs or use the Empty story.

function makeManyRows(count: number): Stock[] {
  const sectors = ["Energy", "IT", "Finance", "FMCG", "Pharma"];
  return Array.from({ length: count }, (_, i) => ({
    symbol: `STOCK${String(i + 1).padStart(2, "0")}`,
    score: Math.round(Math.random() * 100),
    tv_price: Math.round((100 + Math.random() * 3000) * 10) / 10,
    upstox_price: Math.round((100 + Math.random() * 3000) * 10) / 10,
    broker_diff: Math.round((Math.random() - 0.5) * 2 * 100) / 100,
    high_52w: 3500,
    to_52w_high: -Math.round(Math.random() * 25 * 10) / 10,
    recent_return_5d: Math.round((Math.random() - 0.5) * 10 * 10) / 10,
    perf_w: Math.round((Math.random() - 0.5) * 10 * 10) / 10,
    sector: sectors[i % sectors.length],
    touched_52w: i % 3 === 0,
  }));
}

export const WithManyRows: Story = {
  args: {
    stocks: makeManyRows(50),
    columns: sampleColumns,
    touchedSymbols: new Set(["STOCK01", "STOCK04"]),
    onSymbolClick: () => {},
    onSymbolHover: () => {},
  },
  parameters: {
    docs: { description: { story: "50 rows — performance / virtualization smoke test (TanStackTable rowWindowSize kicks in above 120 rows)." } },
  },
};
