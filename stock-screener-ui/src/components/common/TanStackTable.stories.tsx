import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Group, Text } from "@/ui";
import { IconDatabaseOff } from "@tabler/icons-react";
import { TanStackTable } from "./TanStackTable";

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  age: number;
}

const users: User[] = [
  { id: 1, name: "Aarav Sharma", email: "aarav@example.com", role: "Trader", age: 34 },
  { id: 2, name: "Diya Patel", email: "diya@example.com", role: "Analyst", age: 28 },
  { id: 3, name: "Rohan Mehta", email: "rohan@example.com", role: "Admin", age: 41 },
  { id: 4, name: "Ishita Rao", email: "ishita@example.com", role: "Analyst", age: 25 },
  { id: 5, name: "Kabir Singh", email: "kabir@example.com", role: "Trader", age: 37 },
  { id: 6, name: "Ananya Iyer", email: "ananya@example.com", role: "Viewer", age: 31 },
  { id: 7, name: "Vivaan Gupta", email: "vivaan@example.com", role: "Trader", age: 45 },
  { id: 8, name: "Meera Nair", email: "meera@example.com", role: "Admin", age: 29 },
  { id: 9, name: "Arjun Reddy", email: "arjun@example.com", role: "Viewer", age: 52 },
  { id: 10, name: "Saanvi Joshi", email: "saanvi@example.com", role: "Analyst", age: 33 },
];

const columns: ColumnDef<User>[] = [
  { accessorKey: "id", header: "ID" },
  { accessorKey: "name", header: "Name" },
  { accessorKey: "email", header: "Email" },
  { accessorKey: "role", header: "Role" },
  { accessorKey: "age", header: "Age" },
];

function makeRows(count: number): User[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `User ${i + 1}`,
    email: `user${i + 1}@example.com`,
    role: ["Trader", "Analyst", "Admin", "Viewer"][i % 4],
    age: 20 + (i % 40),
  }));
}

const meta: Meta<typeof TanStackTable<User>> = {
  title: "Composites/TanStackTable",
  component: TanStackTable,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          'Headless table (TanStack) with Mantine styling — sorting, windowing (`rowWindowSize`), sticky header, empty/loading states. Use for any tabular data with >20 rows. When not: for 2-3 stat cards use `CompactStatGrid`.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof TanStackTable<User>>;

export const Basic: Story = {
  render: () => (
    <div style={{ height: 420 }}>
      <TanStackTable data={users} columns={columns} />
    </div>
  ),
};

export const Sortable: Story = {
  render: () => (
    <div style={{ height: 420 }}>
      <TanStackTable
        data={users}
        columns={columns}
        initialState={{ sorting: [{ id: "name", desc: false }] }}
      />
    </div>
  ),
};

export const WithRowClick: Story = {
  render: () => (
    <div style={{ height: 420 }}>
      <TanStackTable
        data={users}
        columns={columns}
        onRowClick={(row) => console.log("row clicked:", row)}
      />
    </div>
  ),
};

export const EmptyState: Story = {
  render: () => (
    <div style={{ height: 300 }}>
      <TanStackTable
        data={[]}
        columns={columns}
        emptyMessage="No users found"
        emptyIcon={<IconDatabaseOff size={24} />}
        emptyAction={<Button size="xs" variant="light">Add user</Button>}
      />
    </div>
  ),
};

export const LoadingState: Story = {
  render: () => (
    <div style={{ height: 300 }}>
      <TanStackTable
        data={[]}
        columns={columns}
        loading
        loadingMessage="Fetching users..."
      />
    </div>
  ),
};

export const WindowedTable: Story = {
  render: () => (
    <Group gap="xs" p="md">
      <div style={{ height: 400, width: "100%" }}>
        <TanStackTable data={makeRows(500)} columns={columns} rowWindowSize={30} />
      </div>
      <Text size="xs" c="dimmed">
        500 rows with rowWindowSize=30 — only a scroll-position window of rows is mounted.
      </Text>
    </Group>
  ),
};
