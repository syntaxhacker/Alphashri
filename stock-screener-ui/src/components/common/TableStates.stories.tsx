import type { Meta, StoryObj } from "@storybook/react";
import { Stack, Button, Title } from "@/ui";
import { TableLoadingState } from "./TableLoadingState";
import { TableEmptyState } from "./TableEmptyState";
import { IconDatabaseOff } from "@tabler/icons-react";

const meta: Meta<typeof TableLoadingState> = {
  title: "Composites/Table States",
  component: TableLoadingState,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          'Table state placeholders — `TableLoadingState` (spinner + message) and `TableEmptyState` (message + optional icon/action). Use as `emptyMessage`/`loading` slots inside `TanStackTable` or any standalone table while data loads or when no rows match. When not: for page-level empty states use `CompactPanel` instead.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof TableLoadingState>;

export const AllTableStates: Story = {
  render: () => (
    <Stack gap="md" p="md">
      <div>
        <Title order={5}>TableLoadingState</Title>
        <TableLoadingState />
      </div>
      <div>
        <Title order={5}>TableLoadingState (custom message)</Title>
        <TableLoadingState message="Fetching positions..." />
      </div>
      <div>
        <Title order={5}>TableLoadingState (no spinner)</Title>
        <TableLoadingState message="Waiting for data..." showSpinner={false} />
      </div>
      <div>
        <Title order={5}>TableEmptyState</Title>
        <TableEmptyState message="No open positions" />
      </div>
      <div>
        <Title order={5}>TableEmptyState with icon</Title>
        <TableEmptyState message="No trades found" icon={<IconDatabaseOff size={24} />} />
      </div>
      <div>
        <Title order={5}>TableEmptyState with action</Title>
        <TableEmptyState
          message="No results yet. Run a backtest."
          action={<Button size="xs">Run Backtest</Button>}
        />
      </div>
    </Stack>
  ),
};

export const LoadingDefault: Story = {};

export const LoadingCustom: Story = {
  args: { message: "Loading positions..." },
};

export const LoadingNoSpinner: Story = {
  args: { showSpinner: false, message: "Calculating..." },
};

export const EmptyDefault: Story = {
  render: () => <TableEmptyState message="No data to display" />,
};

export const EmptyWithAction: Story = {
  render: () => (
    <TableEmptyState
      message="No open positions"
      action={<Button size="xs" variant="light">Refresh</Button>}
    />
  ),
};
