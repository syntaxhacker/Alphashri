import type { Meta, StoryObj } from "@storybook/react";
import { Box } from "@mantine/core";
import { MarketTicker } from "./MarketTicker";
import type { MarketTickerData } from "./MarketTicker";

const mockMarketData: MarketTickerData = {
  tickers: {
    "^NSEI": {
      symbol: "^NSEI",
      name: "Nifty 50",
      price: 22567.8,
      change: 156.25,
      change_percent: 0.7,
      is_positive: true,
    },
    "^NSEBANK": {
      symbol: "^NSEBANK",
      name: "Bank Nifty",
      price: 48234.5,
      change: -234.1,
      change_percent: -0.48,
      is_positive: false,
    },
    "GC=F": {
      symbol: "GC=F",
      name: "Gold",
      price: 2034.6,
      change: 12.3,
      change_percent: 0.61,
      is_positive: true,
    },
    "SI=F": {
      symbol: "SI=F",
      name: "Silver",
      price: 22.89,
      change: -0.45,
      change_percent: -1.93,
      is_positive: false,
    },
    "CL=F": {
      symbol: "CL=F",
      name: "Crude Oil",
      price: 76.34,
      change: 1.23,
      change_percent: 1.64,
      is_positive: true,
    },
    "USDINR=X": {
      symbol: "USDINR=X",
      name: "USD/INR",
      price: 83.12,
      change: 0.05,
      change_percent: 0.06,
      is_positive: true,
    },
  },
  last_updated: new Date().toISOString(),
  loading: false,
  error: null,
};

const mockLoadingData: MarketTickerData = {
  tickers: {},
  last_updated: null,
  loading: true,
  error: null,
};

const mockErrorData: MarketTickerData = {
  tickers: {},
  last_updated: null,
  loading: false,
  error: "Failed to fetch market data",
};

const meta: Meta<typeof MarketTicker> = {
  title: "Examples/App Layout/MarketTicker",
  component: MarketTicker,
  tags: ["autodocs"],
  decorators: [
    (Story, context) => {
      const data = context.parameters.marketData || mockMarketData;

      const mockFetch = Promise.resolve({
        ok: true,
        json: () => Promise.resolve(data),
      }) as unknown as ReturnType<typeof fetch>;

      window.fetch = () => mockFetch;

      return (
        <Box style={{ width: "100%", maxWidth: 900 }}>
          <Story />
        </Box>
      );
    },
  ],
};

export default meta;
type Story = StoryObj<typeof MarketTicker>;

export const Default: Story = {
  parameters: {
    marketData: mockMarketData,
  },
};

export const PositiveTickers: Story = {
  parameters: {
    marketData: {
      ...mockMarketData,
      tickers: {
        "^NSEI": {
          symbol: "^NSEI",
          name: "Nifty 50",
          price: 22567.8,
          change: 256.75,
          change_percent: 1.15,
          is_positive: true,
        },
        "^NSEBANK": {
          symbol: "^NSEBANK",
          name: "Bank Nifty",
          price: 48234.5,
          change: 542.3,
          change_percent: 1.14,
          is_positive: true,
        },
        "GC=F": {
          symbol: "GC=F",
          name: "Gold",
          price: 2034.6,
          change: 28.9,
          change_percent: 1.44,
          is_positive: true,
        },
      },
    },
  },
};

export const NegativeTickers: Story = {
  parameters: {
    marketData: {
      ...mockMarketData,
      tickers: {
        "^NSEI": {
          symbol: "^NSEI",
          name: "Nifty 50",
          price: 22123.45,
          change: -287.6,
          change_percent: -1.28,
          is_positive: false,
        },
        "^NSEBANK": {
          symbol: "^NSEBANK",
          name: "Bank Nifty",
          price: 47123.8,
          change: -645.2,
          change_percent: -1.35,
          is_positive: false,
        },
        "USDINR=X": {
          symbol: "USDINR=X",
          name: "USD/INR",
          price: 83.45,
          change: -0.28,
          change_percent: -0.33,
          is_positive: false,
        },
      },
    },
  },
};

export const Loading: Story = {
  parameters: {
    marketData: mockLoadingData,
  },
};

export const Error: Story = {
  parameters: {
    marketData: mockErrorData,
  },
};
