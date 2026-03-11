import type { Meta, StoryObj } from "@storybook/react";
import { ScreenerFilters } from "./ScreenerFilters";

const sectors = ["Technology", "Finance", "Energy", "Healthcare", "FMCG", "IT", "Manufacturing"];

const sampleProfileFilters = [
  {
    key: "marketCap",
    label: "Market Cap (Cr)",
    type: "number" as const,
    min: 0,
    max: 100000,
    step: 100,
  },
  {
    key: "peRatio",
    label: "P/E Ratio",
    type: "number" as const,
    min: 0,
    max: 100,
    step: 0.5,
  },
  {
    key: "dividendYield",
    label: "Dividend Yield",
    type: "number" as const,
    min: 0,
    max: 20,
    step: 0.1,
  },
  {
    key: "volumeType",
    label: "Volume Type",
    type: "select" as const,
    options: [
      { value: "high", label: "High" },
      { value: "medium", label: "Medium" },
      { value: "low", label: "Low" },
    ],
  },
];

const meta: Meta<typeof ScreenerFilters> = {
  title: "Design System/Screener/Filters",
  component: ScreenerFilters,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof ScreenerFilters>;

export const DefaultFilters: Story = {
  args: {
    minScore: 0,
    maxPrice: 0,
    minReturn: 0,
    sector: "",
    sectors,
    profileFilters: [],
    profileFilterValues: {},
    onFilterChange: () => {},
    onReset: () => {},
  },
};

export const WithSomeFiltersApplied: Story = {
  args: {
    minScore: 70,
    maxPrice: 5000,
    minReturn: 2.5,
    sector: "Technology",
    sectors,
    profileFilters: [],
    profileFilterValues: {},
    onFilterChange: () => {},
    onReset: () => {},
  },
};

export const WithFilters: Story = {
  args: {
    minScore: 60,
    maxPrice: 3000,
    minReturn: 1.5,
    sector: "Finance",
    sectors,
    profileFilters: sampleProfileFilters,
    profileFilterValues: {
      marketCap: 10000,
      peRatio: 25,
    },
    onFilterChange: () => {},
    onReset: () => {},
  },
};

export const WithAllFiltersApplied: Story = {
  args: {
    minScore: 80,
    maxPrice: 2000,
    minReturn: 5,
    sector: "IT",
    sectors,
    profileFilters: sampleProfileFilters,
    profileFilterValues: {
      marketCap: 5000,
      peRatio: 20,
      dividendYield: 2,
      volumeType: "high",
    },
    onFilterChange: () => {},
    onReset: () => {},
  },
};

export const WithSelectProfileFilter: Story = {
  args: {
    minScore: 50,
    maxPrice: 0,
    minReturn: 0,
    sector: "",
    sectors,
    profileFilters: sampleProfileFilters,
    profileFilterValues: {
      volumeType: "medium",
    },
    onFilterChange: () => {},
    onReset: () => {},
  },
};
