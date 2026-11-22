import { createComponent, type JSX } from "solid-js";
import { formatAgriPrice, formatArrivals } from "@/config/agri";
import type { SortEntry, TableColumnDef } from "@/components/common/TanStackTable";
import { BadgeCell, NumCell, TextCell } from "@/components/common/tableCells";

/** The quote table's declared default: highest modal price first. */
export const AGRI_QUOTE_DEFAULT_SORT: SortEntry[] = [{ id: "modal", desc: true }];

/** Row shape shared by live mandi quotes and the older snapshot fallback. */
export interface AgriTableViewRow {
  key: string;
  commodity: string;
  group: string;
  state: string;
  district: string;
  market: string;
  variety: string;
  min: number | null;
  modal: number | null;
  max: number | null;
  arrivals_qtl: number | null;
  date: string;
  commodityKey: string;
  stateName: string;
  districtName: string;
  marketName: string;
}

const money = (value: number | null | undefined): string => formatAgriPrice(value);

/** Text left, numbers right, status centre — every column declares its align. */
export function agriColumns(asOf: string | null = null): TableColumnDef<AgriTableViewRow>[] {
  const cell = (render: (row: AgriTableViewRow) => JSX.Element) =>
    ({ row }: { row: { original: AgriTableViewRow } }) => render(row.original);
  const isLatest = (row: AgriTableViewRow) => !!asOf && row.date === asOf;

  return [
    {
      id: "commodity",
      header: "Commodity",
      accessorKey: "commodity",
      size: 112,
      meta: { align: "left" },
      cell: cell((row) => createComponent(TextCell, { value: row.commodity, fw: 700, truncate: false })),
    },
    {
      id: "state",
      header: "State",
      accessorKey: "state",
      size: 96,
      meta: { align: "left" },
      cell: cell((row) => createComponent(TextCell, { value: row.state })),
    },
    {
      id: "district",
      header: "District",
      accessorKey: "district",
      size: 108,
      meta: { align: "left" },
      cell: cell((row) => createComponent(TextCell, { value: row.district })),
    },
    {
      id: "market",
      header: "Market / Mandi",
      accessorKey: "market",
      size: 128,
      meta: { align: "left" },
      cell: cell((row) => createComponent(TextCell, { value: row.market })),
    },
    {
      id: "variety",
      header: "Variety",
      accessorKey: "variety",
      size: 104,
      meta: { align: "left" },
      cell: cell((row) => createComponent(TextCell, { value: row.variety })),
    },
    {
      id: "min",
      header: "Min ₹/qtl",
      accessorKey: "min",
      size: 112,
      meta: { align: "right" },
      cell: cell((row) => createComponent(NumCell, { value: row.min, format: money, align: "right" })),
    },
    {
      id: "modal",
      header: "Modal ₹/qtl",
      accessorKey: "modal",
      size: 116,
      meta: { align: "right" },
      cell: cell((row) => createComponent(NumCell, { value: row.modal, format: money, align: "right", fw: 700 })),
    },
    {
      id: "max",
      header: "Max ₹/qtl",
      accessorKey: "max",
      size: 112,
      meta: { align: "right" },
      cell: cell((row) => createComponent(NumCell, { value: row.max, format: money, align: "right" })),
    },
    {
      id: "arrivals",
      header: "Arrivals qtl",
      accessorFn: (row) => row.arrivals_qtl,
      size: 112,
      meta: { align: "right" },
      cell: cell((row) => createComponent(NumCell, { value: row.arrivals_qtl, format: formatArrivals, align: "right" })),
    },
    {
      id: "date",
      header: "Date",
      accessorKey: "date",
      size: 96,
      meta: { align: "left" },
      cell: cell((row) => createComponent(TextCell, { value: row.date, mono: true })),
    },
    {
      id: "status",
      header: "Status",
      accessorFn: (row) => (isLatest(row) ? "Latest" : "Past"),
      size: 72,
      meta: { align: "center" },
      cell: cell((row) =>
        createComponent(BadgeCell, {
          label: isLatest(row) ? "Latest" : "Past",
          color: isLatest(row) ? "success" : "secondary",
          testId: `agri-status-${row.key}`,
        }),
      ),
    },
  ];
}
