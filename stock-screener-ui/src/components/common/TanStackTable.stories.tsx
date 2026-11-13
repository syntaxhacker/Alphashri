import type { Meta, StoryObj } from "@storybook/html-vite";
import { solidStory } from "@/stories/solidStory";
import { TanStackTable, type TableColumnDef } from "./TanStackTable";
import * as palette from "@/ui/palette";

interface Row {
  symbol: string;
  ltp: number;
  chg: number;
  oi: number;
}

const rows: Row[] = [
  { symbol: "NIFTY", ltp: 5842.31, chg: 0.32, oi: 1_204_500 },
  { symbol: "BANKNIFTY", ltp: 51_284.5, chg: -0.18, oi: 884_200 },
  { symbol: "FINNIFTY", ltp: 23_410.2, chg: 0.12, oi: 402_100 },
  { symbol: "MIDCPNIFTY", ltp: 12_884.0, chg: -0.44, oi: 118_900 },
];

const columns: TableColumnDef<Row>[] = [
  { id: "symbol", header: "Symbol", accessorKey: "symbol", meta: { align: "left" } },
  { id: "ltp", header: "LTP", accessorKey: "ltp", meta: { align: "right" } },
  {
    id: "chg",
    header: "Chg %",
    accessorFn: (row) => row.chg,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span style={{ color: row.original.chg >= 0 ? palette.POSITIVE_COLOR : palette.NEGATIVE_COLOR }}>
        {row.original.chg.toFixed(2)}
      </span>
    ),
  },
  { id: "oi", header: "OI", accessorKey: "oi", meta: { align: "right" } },
];

const meta: Meta = { title: "Terminal/Dense table", tags: ["autodocs"] };
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () =>
    solidStory(() => (
      <div style={{ width: "640px" }}>
        <TanStackTable data={rows} columns={columns} dataTestId="story-table" stickyHeader />
      </div>
    )),
};
