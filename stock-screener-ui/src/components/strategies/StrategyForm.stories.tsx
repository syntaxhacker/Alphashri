import type { Meta, StoryObj } from "@storybook/react";
import { MantineProvider } from "@mantine/core";
import { StrategyForm } from "./StrategyForm";
import type { StrategyFormData } from "./types";
import type { StrategyConfig } from "../../types/strategies";

const meta: Meta<typeof StrategyForm> = {
  title: "Examples/Strategies/Form",
  component: StrategyForm,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <MantineProvider>
        <Story />
      </MantineProvider>
    ),
  ],
  parameters: {
    layout: "centered",
  },
};

export default meta;
type Story = StoryObj<typeof StrategyForm>;

const mockStrategy: StrategyConfig = {
  id: 1,
  name: "My Custom Strategy",
  strategy_type: "ORB_Bullish",
  parent_id: null,
  is_template: false,
  is_active: true,
  is_default: false,
  description: "A custom ORB bullish strategy",
  or_minutes: 15,
  sl_pct: 0.5,
  tp_pct: 1.0,
  min_or_range_pct: 0.3,
  max_or_range_pct: 2.0,
  max_positions: 3,
  max_capital_per_trade_pct: 20,
  max_daily_loss_pct: 5,
  max_total_exposure_pct: 50,
  risk_per_trade_pct: 2,
  min_trade_value: 5000,
  max_trade_value: 100000,
  cooldown_minutes: 30,
  max_distance_from_or_pct: 1.5,
  brokerage_pct: 0.05,
  min_brokerage: 20,
  stt_pct: 0.001,
  exchange_pct: 0.0003,
  sebi_pct: 0.0001,
  stamp_pct: 0.0003,
  gst_pct: 0.18,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

const mockTemplate: StrategyConfig = {
  ...mockStrategy,
  id: 10,
  name: "ORB Bullish Template",
  is_template: true,
};

export const CreateNew: Story = {
  args: {
    mode: "create",
    opened: true,
    strategy: null,
    template: null,
    onClose: () => {},
    onSubmit: (data: StrategyFormData) => console.log("Submit:", data),
  },
};

export const EditExisting: Story = {
  args: {
    mode: "edit",
    opened: true,
    strategy: mockStrategy,
    template: null,
    onClose: () => {},
    onSubmit: (data: StrategyFormData) => console.log("Submit:", data),
  },
};

export const CreateFromTemplate: Story = {
  args: {
    mode: "create",
    opened: true,
    strategy: null,
    template: mockTemplate,
    onClose: () => {},
    onSubmit: (data: StrategyFormData) => console.log("Submit:", data),
  },
};

export const CreateBearish: Story = {
  args: {
    mode: "create",
    opened: true,
    strategy: null,
    template: { ...mockTemplate, strategy_type: "ORB_Bearish", name: "ORB Bearish Template" },
    onClose: () => {},
    onSubmit: (data: StrategyFormData) => console.log("Submit:", data),
  },
};

export const Closed: Story = {
  args: {
    mode: "create",
    opened: false,
    strategy: null,
    template: null,
    onClose: () => {},
    onSubmit: (data: StrategyFormData) => console.log("Submit:", data),
  },
};
