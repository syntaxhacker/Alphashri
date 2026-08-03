import type { Meta, StoryObj } from "@storybook/react";
import { Stack, Text } from "@/ui";
import { ClickableSymbol } from "./ClickableSymbol";
import { MemoryRouter } from "react-router-dom";
import { PreviewChartProvider } from "./PreviewChartProvider";

const meta: Meta<typeof ClickableSymbol> = {
  title: "Design System/Common/ClickableSymbol",
  component: ClickableSymbol,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <MemoryRouter>
        <PreviewChartProvider>
          <Stack gap="sm" p="md">
            <Story />
          </Stack>
        </PreviewChartProvider>
      </MemoryRouter>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ClickableSymbol>;

export const Default: Story = {
  args: { symbol: "RELIANCE" },
};

export const WithPreview: Story = {
  args: { symbol: "TCS", showPreview: true },
};

export const CustomSize: Story = {
  render: () => (
    <Stack gap="sm">
      <Text size="xs">Various font weights:</Text>
      <ClickableSymbol symbol="INFY" fw={400} />
      <ClickableSymbol symbol="HDFC" fw={600} />
      <ClickableSymbol symbol="SBIN" fw={800} />
    </Stack>
  ),
};
