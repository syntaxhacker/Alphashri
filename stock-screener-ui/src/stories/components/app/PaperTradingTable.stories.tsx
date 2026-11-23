import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { Box, Text } from "@/ui";
import * as palette from "@/ui/palette";
import {
  TanStackTable as PaperTradingTable,
  type SortEntry,
  type TableColumnDef,
} from "@/components/paper-trading/TanStackTable";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack, PAPER_TABLE_WIDTH } from "./StoryFrame";

const FIXTURE_LABEL = "frozen paper book snapshot · 2026-11-20 15:10 IST";

interface PaperPosition {
  symbol: string;
  side: "LONG" | "SHORT";
  qty: number;
  avg: number;
  ltp: number;
  pnl: number;
}

const POSITIONS: PaperPosition[] = [
  Object.freeze({ symbol: "NIFTY 24SEP FUT", side: "LONG", qty: 75, avg: 23412.4, ltp: 23450.85, pnl: 2883.75 }),
  Object.freeze({ symbol: "RELIANCE", side: "LONG", qty: 200, avg: 2841.5, ltp: 2832.1, pnl: -1880 }),
  Object.freeze({ symbol: "TCS", side: "SHORT", qty: 150, avg: 4120.0, ltp: 4102.5, pnl: 2625 }),
  Object.freeze({ symbol: "BANKNIFTY 24SEP FUT", side: "SHORT", qty: 30, avg: 51310.0, ltp: 51284.5, pnl: 765 }),
  Object.freeze({ symbol: "INFY", side: "LONG", qty: 400, avg: 1872.3, ltp: 1884.6, pnl: 4920 }),
  Object.freeze({ symbol: "HDFCBANK", side: "SHORT", qty: 250, avg: 1712.4, ltp: 1703.8, pnl: 2150 }),
  Object.freeze({ symbol: "ICICIBANK", side: "LONG", qty: 300, avg: 1318.2, ltp: 1326.7, pnl: 2550 }),
  Object.freeze({ symbol: "NIFTY 26NOV FUT", side: "LONG", qty: 50, avg: 23420.0, ltp: 23450.85, pnl: 1542.5 }),
];

const money = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

const POSITION_COLUMNS: TableColumnDef<PaperPosition>[] = [
  { id: "symbol", header: "Symbol", accessorKey: "symbol", meta: { align: "left" }, size: 190 },
  {
    id: "side",
    header: "Side",
    accessorKey: "side",
    meta: { align: "center" },
    size: 90,
    cell: ({ row }) => (
      <span
        style={{
          color: row.original.side === "LONG" ? "var(--color-fin-positive)" : "var(--color-fin-negative)",
          "font-variant-numeric": "tabular-nums",
        }}
      >
        {row.original.side}
      </span>
    ),
  },
  { id: "qty", header: "Qty", accessorKey: "qty", meta: { align: "right" }, size: 100, cell: ({ row }) => qtyFormat.format(row.original.qty) },
  { id: "avg", header: "Avg", accessorKey: "avg", meta: { align: "right" }, size: 126, cell: ({ row }) => money.format(row.original.avg) },
  { id: "ltp", header: "LTP", accessorKey: "ltp", meta: { align: "right" }, size: 126, cell: ({ row }) => money.format(row.original.ltp) },
  {
    id: "pnl",
    header: "P&L",
    accessorKey: "pnl",
    meta: { align: "right" },
    size: 150,
    cell: ({ row }) => {
      const value = row.original.pnl;
      return (
        <span style={{ color: value >= 0 ? "var(--color-fin-positive)" : "var(--color-fin-negative)" }}>
          {value >= 0 ? "+" : ""}
          {money.format(value)}
        </span>
      );
    },
  },
];

type PaperTableArgs = {
  dense: boolean;
  stickyHeader: boolean;
  loading: boolean;
  emptyMessage: string;
  getRowKey?: (row: PaperPosition) => string;
  rowWindowSize?: number;
};

const meta: Meta<PaperTableArgs> = {
  title: "Design System/Components/App/PaperTradingTable",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The paper-trading / replay table in src/components/paper-trading/TanStackTable.tsx. " +
          "It is now a thin compatibility wrapper over the shared common table: rendering, sorting, " +
          "selection, grouping, expanded rows and virtualization all come from that one implementation. " +
          "The wrapper restores this family's defaults — 23px baseline rows (`metricsPreset: paper`), " +
          "value-keyed row remounts for live ticks, raw group-expansion keys and groups expanded by " +
          "default. `enableSorting` is on by default; the column picker stays opt-in. " +
          "This page uses the real `TableProps<T>` surface with a frozen paper-book fixture.",
      },
    },
  },
  args: {
    dense: false,
    stickyHeader: true,
    loading: false,
    emptyMessage: "No paper positions",
  },
  argTypes: {
    dense: { control: "boolean", description: "Ultra-dense 18px rows, same flag name as the common table." },
    stickyHeader: { control: "boolean", description: "Pins the header while the body scrolls." },
    loading: { control: "boolean", description: "Inline loader when data is empty." },
    emptyMessage: { control: "text", description: "Copy for the empty body." },
    getRowKey: { control: false, description: "Stable identity used to keep row DOM across live price ticks." },
    rowWindowSize: { control: false, description: "Caps the mounted window, like the common table." },
  },
};
export default meta;
type Story = StoryObj<PaperTableArgs>;

const rowMeta = (count: number, extra?: string) => `${count} rows · 6 columns${extra ? ` · ${extra}` : ""}`;

/** Baseline 23px rows, sticky header, explicit meta.align on every column. */
export const Normal: Story = {
  render: (args) =>
    solidStory(() => (
      <DemoStack width={PAPER_TABLE_WIDTH}>
        <DemoPanel
          title="Paper book · normal density"
          detail={`${FIXTURE_LABEL} · ROW_ESTIMATED 23 · cell pad 2px 8px · sortable by default`}
          meta={rowMeta(POSITIONS.length)}
          testId="story-paper-table-normal-frame"
        >
          <PaperTradingTable
            data={POSITIONS}
            columns={POSITION_COLUMNS}
            dataTestId="story-paper-table-normal"
            ariaLabel="Frozen paper positions, normal density"
            dense={args.dense}
            stickyHeader={args.stickyHeader}
            loading={args.loading}
            emptyMessage={args.emptyMessage}
            getRowKey={(row) => row.symbol}
            bare
            style={{ width: "100%" }}
          />
        </DemoPanel>
      </DemoStack>
    )),
};

export const Dense: Story = {
  args: { dense: true, emptyMessage: "No dense positions" },
  render: (args) =>
    solidStory(() => (
      <DemoStack width={PAPER_TABLE_WIDTH}>
        <DemoPanel
          title="Paper book · ultra-dense"
          detail={`${FIXTURE_LABEL} · dense: 18px row height, 10px type, 20px header`}
          meta={rowMeta(POSITIONS.length, "dense")}
          testId="story-paper-table-dense-frame"
        >
          <PaperTradingTable
            data={POSITIONS}
            columns={POSITION_COLUMNS}
            dataTestId="story-paper-table-dense"
            ariaLabel="Frozen paper positions, dense"
            dense={args.dense}
            stickyHeader={args.stickyHeader}
            getRowKey={(row) => row.symbol}
            bare
            style={{ width: "100%" }}
          />
        </DemoPanel>
      </DemoStack>
    )),
};

/** Controlled sorting is driven only by `sorting` + `onSortingChange`. */
export const Sortable: Story = {
  render: () =>
    solidStory(() => {
      const [sorting, setSorting] = createSignal<SortEntry[]>([{ id: "pnl", desc: true }]);
      return (
        <DemoStack width={PAPER_TABLE_WIDTH}>
          <DemoPanel
            title="Paper book · controlled sorting"
            detail={`${FIXTURE_LABEL} · directive is the only source of truth`}
            metaNode={
              <Text size="xs" c="secondary" aria-live="polite">{`sorting: ${JSON.stringify(sorting())}`}</Text>
            }
            testId="story-paper-table-sortable-frame"
          >
            <PaperTradingTable
              data={POSITIONS}
              columns={POSITION_COLUMNS}
              dataTestId="story-paper-table-sortable"
              ariaLabel="Sortable frozen paper positions"
              sorting={sorting()}
              onSortingChange={setSorting}
              enableSorting
              enableSortingRemoval
              stickyHeader
              getRowKey={(row) => row.symbol}
              bare
              style={{ width: "100%" }}
            />
          </DemoPanel>
        </DemoStack>
      );
    }),
};

export const Loading: Story = {
  args: { loading: true },
  render: (args) =>
    solidStory(() => (
      <DemoStack width={PAPER_TABLE_WIDTH}>
        <DemoPanel
          title="Paper book · loading"
          detail={`${FIXTURE_LABEL} · 0 rows: loadingMessage is shown in the table body`}
          meta="0 rows · loading"
          testId="story-paper-table-loading-frame"
        >
          <PaperTradingTable
            data={[]}
            columns={POSITION_COLUMNS}
            dataTestId="story-paper-table-loading"
            ariaLabel="Loading paper positions"
            loading={args.loading}
            loadingMessage="Refreshing the paper book"
            bare
            style={{ width: "100%" }}
          />
        </DemoPanel>
      </DemoStack>
    )),
};

export const Empty: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack width={PAPER_TABLE_WIDTH}>
        <DemoPanel
          title="Paper book · empty"
          detail={`${FIXTURE_LABEL} · emptyMessage + emptyIcon are real Props`}
          meta="0 positions · book is flat"
          testId="story-paper-table-empty-frame"
        >
          <PaperTradingTable
            data={[]}
            columns={POSITION_COLUMNS}
            dataTestId="story-paper-table-empty"
            ariaLabel="Empty paper positions"
            emptyMessage="No open paper positions — place one from the screener"
            emptyIcon={<span aria-hidden="true">○</span>}
            bare
            style={{ width: "100%" }}
          />
        </DemoPanel>
      </DemoStack>
    )),
};

/** Selection uses `getRowStyle` + `getRowAttributes`; no selection prop exists. */
export const SelectedRow: Story = {
  render: () =>
    solidStory(() => {
      const [selected, setSelected] = createSignal<string>("NIFTY 24SEP FUT");
      const columns = POSITION_COLUMNS.map((column) =>
        column.id === "symbol"
          ? {
              ...column,
              cell: ({ row }: { row: { original: PaperPosition } }) => (
                <span
                  style={{
                    display: "inline-flex",
                    "align-items": "center",
                    gap: "8px",
                    color: row.original.symbol === selected() ? "var(--color-fin-primary)" : "var(--color-fin-text)",
                    "font-weight": row.original.symbol === selected() ? 700 : 400,
                  }}
                >
                  <span aria-hidden="true">{row.original.symbol === selected() ? "▸" : " "}</span>
                  {row.original.symbol}
                </span>
              ),
            }
          : column,
      );
      return (
        <DemoStack width={PAPER_TABLE_WIDTH}>
          <DemoPanel
            title="Paper book · selected row"
            detail={`${FIXTURE_LABEL} · selection via getRowStyle + getRowAttributes`}
            metaNode={
              <Text size="xs" c="secondary" aria-live="polite">{`selected: ${selected()}`}</Text>
            }
            testId="story-paper-table-selected-frame"
          >
            <PaperTradingTable
              data={POSITIONS}
              columns={columns}
              dataTestId="story-paper-table-selected"
              ariaLabel="Frozen paper positions with selection"
              stickyHeader
              onRowClick={(row) => setSelected(row.symbol)}
              getRowKey={(row) => row.symbol}
              getRowStyle={(row) =>
                row.symbol === selected()
                  ? {
                      "background-color": palette.alpha(palette.PRIMARY, 0.14),
                      "box-shadow": `inset 2px 0 0 ${palette.PRIMARY}`,
                    }
                  : undefined
              }
              getRowAttributes={(row) => ({ "data-selected": row.symbol === selected() ? "true" : "false" })}
              bare
              style={{ width: "100%" }}
            />
          </DemoPanel>
        </DemoStack>
      );
    }),
};

export const Grouped: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack width={PAPER_TABLE_WIDTH}>
        <DemoPanel
          title="Paper book · grouped by side"
          detail={`${FIXTURE_LABEL} · enableGrouping + grouping + full-width renderGroupHeader`}
          meta={`${POSITIONS.length} rows · 2 groups`}
          testId="story-paper-table-grouped-frame"
        >
          <PaperTradingTable
            data={POSITIONS}
            columns={POSITION_COLUMNS}
            dataTestId="story-paper-table-grouped"
            ariaLabel="Frozen paper positions grouped by side"
            enableGrouping
            grouping={["side"]}
            getGroupRowTestId={(value) => `story-paper-group-${String(value)}`}
            renderGroupHeader={(group) => (
              <span className="text-ui-micro" style={{ color: "var(--color-fin-primary)" }}>
                {String(group.value)} · {group.rows.length} positions · {group.isExpanded() ? "expanded" : "collapsed"}
              </span>
            )}
            stickyHeader
            getRowKey={(row) => row.symbol}
            bare
            style={{ width: "100%" }}
          />
        </DemoPanel>
      </DemoStack>
    )),
};

/** Expandable rows are a paper-table-only prop pair. */
export const Expandable: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack width={PAPER_TABLE_WIDTH}>
        <DemoPanel
          title="Paper book · expandable rows"
          detail={`${FIXTURE_LABEL} · click a NIFTY row to expand its frozen entry reason`}
          meta={rowMeta(POSITIONS.length, "2 expandable")}
          testId="story-paper-table-expandable-frame"
        >
          <PaperTradingTable
            data={POSITIONS}
            columns={POSITION_COLUMNS}
            dataTestId="story-paper-table-expandable"
            ariaLabel="Expandable frozen paper positions"
            stickyHeader
            getRowKey={(row) => row.symbol}
            getRowCanExpand={(row) => row.symbol.startsWith("NIFTY")}
            renderSubComponent={(row) => (
              <Box style={{ padding: "8px 12px", "background-color": "var(--color-fin-surface-alt)" }}>
                <Text size="xs">{`${row.symbol} · frozen entry reason: ORB breakout · qty ${row.qty}`}</Text>
              </Box>
            )}
            bare
            style={{ width: "100%" }}
          />
        </DemoPanel>
      </DemoStack>
    )),
};

/** `bare` skips the outer Paper wrapper — useful inside an existing panel. */
export const Bare: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack width={PAPER_TABLE_WIDTH}>
        <DemoPanel
          title="Paper book · bare mode"
          detail={`${FIXTURE_LABEL} · caller-owned raised surface supplies the frame; the table adds no Paper of its own`}
          meta={rowMeta(POSITIONS.length, "bare")}
          testId="story-paper-table-bare-frame"
        >
          <Box style={{ padding: "8px", "background-color": "var(--color-fin-surface-alt)" }}>
            <PaperTradingTable
              data={POSITIONS}
              columns={POSITION_COLUMNS}
              dataTestId="story-paper-table-bare"
              ariaLabel="Bare frozen paper positions"
              bare
              stickyHeader
              getRowKey={(row) => row.symbol}
              style={{ width: "100%" }}
            />
          </Box>
        </DemoPanel>
      </DemoStack>
    )),
};
