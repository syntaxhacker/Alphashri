import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { DensityProvider, DENSITY_TOKENS, Text } from "@/ui";
import * as palette from "@/ui/palette";
import {
  TanStackTable,
  TABLE_METRICS,
  type ColumnPrefs,
  type SortEntry,
  type TableColumnDef,
} from "@/components/common/TanStackTable";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack, TABLE_WIDTH } from "./StoryFrame";

const FIXTURE_LABEL = "frozen index quote snapshot · 2026-11-20 09:15 IST";

interface IndexQuote {
  symbol: string;
  ltp: number;
  changePct: number;
  oi: number;
}

const INDEX_QUOTES: IndexQuote[] = [
  Object.freeze({ symbol: "NIFTY", ltp: 23450.85, changePct: 0.08, oi: 1_204_500 }),
  Object.freeze({ symbol: "BANKNIFTY", ltp: 51284.5, changePct: -0.18, oi: 884_200 }),
  Object.freeze({ symbol: "FINNIFTY", ltp: 23410.2, changePct: 0.12, oi: 402_100 }),
  Object.freeze({ symbol: "MIDCPNIFTY", ltp: 12884.0, changePct: -0.44, oi: 118_900 }),
  Object.freeze({ symbol: "NIFTYIT", ltp: 38942.7, changePct: 0.31, oi: 214_600 }),
  Object.freeze({ symbol: "NIFTYPHARMA", ltp: 22118.35, changePct: -0.09, oi: 96_400 }),
  Object.freeze({ symbol: "NIFTYFMCG", ltp: 54876.15, changePct: 0.22, oi: 142_800 }),
  Object.freeze({ symbol: "NIFTY PSU BANK", ltp: 6142.9, changePct: -0.27, oi: 73_500 }),
];

const numberFormat = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const integerFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const directionOf = (quote: IndexQuote) => (quote.changePct >= 0 ? "Advancing" : "Declining");

const INDEX_COLUMNS: TableColumnDef<IndexQuote>[] = [
  { id: "symbol", header: "Symbol", accessorKey: "symbol", meta: { align: "left" }, size: 160 },
  {
    id: "ltp",
    header: "LTP",
    accessorKey: "ltp",
    meta: { align: "right" },
    size: 150,
    cell: ({ row }) => numberFormat.format(row.original.ltp),
  },
  {
    id: "changePct",
    header: "Chg %",
    accessorKey: "changePct",
    meta: { align: "right" },
    size: 130,
    cell: ({ row }) => {
      const value = row.original.changePct;
      return (
        <span
          style={{
            color: value >= 0 ? "var(--color-fin-positive)" : "var(--color-fin-negative)",
            "font-variant-numeric": "tabular-nums",
          }}
        >
          {value >= 0 ? "+" : ""}
          {value.toFixed(2)}
        </span>
      );
    },
  },
  {
    id: "oi",
    header: "OI",
    accessorKey: "oi",
    meta: { align: "right" },
    size: 160,
    cell: ({ row }) => integerFormat.format(row.original.oi),
  },
  // Hidden spacer: a real accessor for the grouping demo, excluded from every
  // visible column (size 0) and from the column picker.
  { id: "direction", header: "Direction", accessorFn: directionOf, size: 0 },
];

const ALL_COLUMN_IDS = ["symbol", "ltp", "changePct", "oi"];

type TableArgs = {
  dense: boolean;
  loading: boolean;
  stickyHeader: boolean;
  emptyMessage: string;
  ariaLabel: string;
};

const meta: Meta<TableArgs> = {
  title: "Design System/Components/App/TanStackTable",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The shared screener/data table (src/components/common/TanStackTable.tsx). " +
          "It owns density, header sorting, row expansion, grouping, virtualization and an " +
          "opt-in column picker. Column `meta.align` is explicit: text left, numbers right, " +
          "badges and actions centre. All colours come from palette tokens / CSS variables; " +
          "the rows below are a frozen, labelled index snapshot.",
      },
    },
  },
  args: {
    dense: false,
    loading: false,
    stickyHeader: true,
    emptyMessage: "No rows for this filter",
    ariaLabel: "Frozen index quote rows",
  },
  argTypes: {
    dense: {
      control: "boolean",
      description: "Ultra-dense rows (18px / 10px type) regardless of the global density store.",
    },
    loading: {
      control: "boolean",
      description: "Shows the shared inline loader when data is empty; populated data stays visible.",
    },
    stickyHeader: {
      control: "boolean",
      description: "Pins the header row inside the scroll area.",
    },
    emptyMessage: {
      control: "text",
      description: "Copy rendered when data is empty and loading is false.",
    },
    ariaLabel: {
      control: "text",
      description: "Accessible name for the underlying <table> element.",
    },
  },
};
export default meta;
type Story = StoryObj<TableArgs>;

const rowMeta = (count: number, extra?: string) => `${count} rows · 4 columns${extra ? ` · ${extra}` : ""}`;

/** Standard density: 32px rows from `TABLE_METRICS.default`. */
export const Normal: Story = {
  render: (args) =>
    solidStory(() => (
      <DemoStack width={TABLE_WIDTH}>
        <DemoPanel
          title="Index quotes · normal density"
          detail={`${FIXTURE_LABEL} · default metrics · row ${TABLE_METRICS.default.rowHeight}px · pad ${TABLE_METRICS.default.cellPadding}`}
          meta={rowMeta(INDEX_QUOTES.length)}
          testId="story-table-normal-frame"
        >
          <TanStackTable
            data={INDEX_QUOTES}
            columns={INDEX_COLUMNS}
            dataTestId="story-table-normal"
            ariaLabel={args.ariaLabel}
            dense={args.dense}
            stickyHeader={args.stickyHeader}
            loading={args.loading}
            emptyMessage={args.emptyMessage}
            bare
            style={{ width: "100%" }}
          />
        </DemoPanel>
      </DemoStack>
    )),
};

/** `dense` opt-in: 18px rows from `TABLE_METRICS.dense` (screener/market contract). */
export const Dense: Story = {
  args: { dense: true, ariaLabel: "Frozen index quotes, ultra-dense" },
  render: (args) =>
    solidStory(() => (
      <DemoStack width={TABLE_WIDTH}>
        <DemoPanel
          title="Index quotes · ultra-dense"
          detail={`${FIXTURE_LABEL} · dense metrics · row ${TABLE_METRICS.dense.rowHeight}px · pad ${TABLE_METRICS.dense.cellPadding}`}
          meta={rowMeta(INDEX_QUOTES.length, "dense")}
          testId="story-table-dense-frame"
        >
          <TanStackTable
            data={INDEX_QUOTES}
            columns={INDEX_COLUMNS}
            dataTestId="story-table-dense"
            ariaLabel={args.ariaLabel}
            dense={args.dense}
            stickyHeader={args.stickyHeader}
            loading={args.loading}
            emptyMessage={args.emptyMessage}
            bare
            style={{ width: "100%" }}
          />
        </DemoPanel>
      </DemoStack>
    )),
};

/**
 * Explicit global `compact` density (the app default). The shared table reads
 * `useDensity()`; the provider is the documented story/test override.
 */
export const Compact: Story = {
  render: () =>
    solidStory(() => (
      <DensityProvider value="compact">
        <DemoStack width={TABLE_WIDTH}>
          <DemoPanel
            title="Index quotes · compact density"
            detail={`${FIXTURE_LABEL} · DENSITY_TOKENS.compact · row ${DENSITY_TOKENS.compact.tableRowHeight}px · pad ${DENSITY_TOKENS.compact.tableCellPad}`}
            meta={rowMeta(INDEX_QUOTES.length, "compact")}
            testId="story-table-compact-frame"
          >
            <TanStackTable
              data={INDEX_QUOTES}
              columns={INDEX_COLUMNS}
              dataTestId="story-table-compact"
              ariaLabel="Frozen index quotes, compact density"
              stickyHeader
              bare
              style={{ width: "100%" }}
            />
          </DemoPanel>
        </DemoStack>
      </DensityProvider>
    )),
};

/** Counterpart to Compact, to make the density switch legible. */
export const Comfortable: Story = {
  render: () =>
    solidStory(() => (
      <DensityProvider value="comfortable">
        <DemoStack width={TABLE_WIDTH}>
          <DemoPanel
            title="Index quotes · comfortable density"
            detail={`${FIXTURE_LABEL} · DENSITY_TOKENS.comfortable · row ${DENSITY_TOKENS.comfortable.tableRowHeight}px · pad ${DENSITY_TOKENS.comfortable.tableCellPad}`}
            meta={rowMeta(INDEX_QUOTES.length, "comfortable")}
            testId="story-table-comfortable-frame"
          >
            <TanStackTable
              data={INDEX_QUOTES}
              columns={INDEX_COLUMNS}
              dataTestId="story-table-comfortable"
              ariaLabel="Frozen index quotes, comfortable density"
              stickyHeader
              bare
              style={{ width: "100%" }}
            />
          </DemoPanel>
        </DemoStack>
      </DensityProvider>
    )),
};

/** Header sorting with an uncontrolled initial sort and a visible live directive. */
export const Sortable: Story = {
  render: () =>
    solidStory(() => {
      const [sorting, setSorting] = createSignal<SortEntry[]>([{ id: "ltp", desc: true }]);
      return (
        <DemoStack width={TABLE_WIDTH}>
          <DemoPanel
            title="Index quotes · sortable headers"
            detail={`${FIXTURE_LABEL} · click a numeric header to sort`}
            metaNode={
              <Text size="xs" c="secondary" aria-live="polite">
                {`sort: ${sorting().map((entry) => `${entry.id} ${entry.desc ? "desc" : "asc"}`).join(", ") || "none"}`}
              </Text>
            }
            testId="story-table-sortable-frame"
          >
            <TanStackTable
              data={INDEX_QUOTES}
              columns={INDEX_COLUMNS}
              dataTestId="story-table-sortable"
              ariaLabel="Sortable frozen index quotes"
              enableSorting
              enableSortingRemoval
              initialSorting={sorting()}
              onSortingChange={setSorting}
              stickyHeader
              bare
              style={{ width: "100%" }}
            />
          </DemoPanel>
        </DemoStack>
      );
    }),
};

/** Controlled sorting: the emitted directive is the only source of truth. */
export const ControlledSorting: Story = {
  render: () =>
    solidStory(() => {
      const [sorting, setSorting] = createSignal<SortEntry[]>([{ id: "changePct", desc: true }]);
      return (
        <DemoStack width={TABLE_WIDTH}>
          <DemoPanel
            title="Index quotes · controlled sorting"
            detail={`${FIXTURE_LABEL} · directive is the only source of truth`}
            metaNode={
              <Text size="xs" c="secondary" aria-live="polite">
                {`directive: ${JSON.stringify(sorting())}`}
              </Text>
            }
            testId="story-table-controlled-sort-frame"
          >
            <TanStackTable
              data={INDEX_QUOTES}
              columns={INDEX_COLUMNS}
              dataTestId="story-table-controlled-sort"
              ariaLabel="Controlled-sort frozen index quotes"
              sorting={sorting()}
              onSortingChange={setSorting}
              enableSorting
              stickyHeader
              bare
              style={{ width: "100%" }}
            />
          </DemoPanel>
        </DemoStack>
      );
    }),
};

/** `loading` on an empty data set renders the shared inline loader. */
export const Loading: Story = {
  args: { loading: true, ariaLabel: "Loading index quotes" },
  render: (args) =>
    solidStory(() => (
      <DemoStack width={TABLE_WIDTH}>
        <DemoPanel
          title="Index quotes · loading"
          detail={`${FIXTURE_LABEL} · no rows yet: loadingMessage is shown in the table body`}
          meta="0 rows · loading"
          testId="story-table-loading-frame"
        >
          <TanStackTable
            data={[]}
            columns={INDEX_COLUMNS}
            dataTestId="story-table-loading"
            ariaLabel={args.ariaLabel}
            loading={args.loading}
            loadingMessage="Loading index quotes"
            emptyMessage={args.emptyMessage}
            stickyHeader={args.stickyHeader}
            bare
            style={{ width: "100%" }}
          />
        </DemoPanel>
      </DemoStack>
    )),
};

/** Empty data with an optional icon and action cell. */
export const Empty: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack width={TABLE_WIDTH}>
        <DemoPanel
          title="Index quotes · empty"
          detail={`${FIXTURE_LABEL} · emptyMessage, emptyIcon and emptyAction are real TableProps`}
          meta="0 rows · filter matched nothing"
          testId="story-table-empty-frame"
        >
          <TanStackTable
            data={[]}
            columns={INDEX_COLUMNS}
            dataTestId="story-table-empty"
            ariaLabel="Empty frozen index quotes"
            emptyMessage="No rows match this filter"
            emptyIcon={<span aria-hidden="true">○</span>}
            emptyAction={<Text size="xs" c="secondary">Widen the universe filter</Text>}
            stickyHeader
            bare
            style={{ width: "100%" }}
          />
        </DemoPanel>
      </DemoStack>
    )),
};

/** Selected row: identity comes from `getRowStyle` / `getRowAttributes`, not a new prop. */
export const SelectedRow: Story = {
  render: () =>
    solidStory(() => {
      const [selected, setSelected] = createSignal<string>("NIFTY");
      return (
        <DemoStack width={TABLE_WIDTH}>
          <DemoPanel
            title="Index quotes · selected row"
            detail={`${FIXTURE_LABEL} · selection via getRowStyle + getRowAttributes`}
            metaNode={
              <Text size="xs" c="secondary" aria-live="polite">{`selected: ${selected()}`}</Text>
            }
            testId="story-table-selected-frame"
          >
            <TanStackTable
              data={INDEX_QUOTES}
              columns={INDEX_COLUMNS}
              dataTestId="story-table-selected"
              ariaLabel="Frozen index quotes with one selected row"
              stickyHeader
              onRowClick={(row) => setSelected(row.symbol)}
              getRowStyle={(row) =>
                row.symbol === selected()
                  ? {
                      "background-color": palette.alpha(palette.PRIMARY, 0.14),
                      "box-shadow": `inset 2px 0 0 ${palette.PRIMARY}`,
                    }
                  : undefined
              }
              getRowAttributes={(row) => ({ "data-selected": row.symbol === selected() ? "true" : "false" })}
              getRowTestId={(row) => `story-selected-row-${row.symbol}`}
              bare
              style={{ width: "100%" }}
            />
          </DemoPanel>
        </DemoStack>
      );
    }),
};

/** Column controls: visibility + keyboard/drag reorder + reset, fully controlled. */
export const ColumnControls: Story = {
  render: () =>
    solidStory(() => {
      const [prefs, setPrefs] = createSignal<ColumnPrefs>({ order: [...ALL_COLUMN_IDS], hidden: [] });
      return (
        <DemoStack width={TABLE_WIDTH}>
          <DemoPanel
            title="Index quotes · column controls"
            detail={`${FIXTURE_LABEL} · visibility + reorder + reset (Symbol locked visible)`}
            meta={rowMeta(INDEX_QUOTES.length, "picker on")}
            testId="story-table-column-controls-frame"
          >
            <>
              <Text size="xs" c="secondary" aria-live="polite" style={{ "margin-bottom": "8px" }}>
                {`Saved prefs · order: ${prefs().order.join(",") || "declared"} · hidden: ${prefs().hidden.join(",") || "none"}`}
              </Text>
              <TanStackTable
                data={INDEX_QUOTES}
                columns={INDEX_COLUMNS}
                dataTestId="story-table-column-controls"
                ariaLabel="Frozen index quotes with column controls"
                enableColumnControls
                tableId="story.table.index"
                columnPrefs={prefs()}
                onColumnPrefsChange={setPrefs}
                lockVisible={["symbol"]}
                stickyHeader
                bare
                style={{ width: "100%" }}
              />
            </>
          </DemoPanel>
        </DemoStack>
      );
    }),
};

/** Grouping with a real full-width group header renderer. */
export const Grouped: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack width={TABLE_WIDTH}>
        <DemoPanel
          title="Index quotes · grouped by direction"
          detail={`${FIXTURE_LABEL} · full-width renderGroupHeader`}
          meta={`${INDEX_QUOTES.length} rows · 2 groups`}
          testId="story-table-grouped-frame"
        >
          <TanStackTable
            data={INDEX_QUOTES}
            columns={INDEX_COLUMNS}
            dataTestId="story-table-grouped"
            ariaLabel="Frozen index quotes grouped by direction"
            enableGrouping
            grouping={["direction"]}
            getGroupRowTestId={(value) => `story-group-${String(value)}`}
            renderGroupHeader={(group) => (
              <span style={{ "font-size": "12px", color: "var(--color-fin-primary)" }}>
                {String(group.value)} · {group.rows.length} rows · {group.isExpanded() ? "expanded" : "collapsed"}
              </span>
            )}
            stickyHeader
            bare
            style={{ width: "100%" }}
          />
        </DemoPanel>
      </DemoStack>
    )),
};
