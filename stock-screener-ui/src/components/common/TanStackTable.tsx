import { For, Show, createEffect } from "solid-js";
import { Button, Paper, ScrollArea, ToolbarRow, useDensity } from "@/ui";
import { InlineLoader } from "./states";
import { ColumnPicker } from "./ColumnPicker";
import { resolveColumnPrefs, useColumnPrefs } from "./table/columnPrefs";
import { getValue, useColumnViews } from "./table/columns";
import { renderGroupRow, renderHeader, renderRow, type TableRenderContext } from "./table/renderers";
import { useSorting } from "./table/sorting";
import type { CSSProperties, TableProps } from "./table/types";
import { useRowWindow } from "./table/windowing";

export { resolveColumnPrefs };
export type {
  ColumnPrefs,
  GroupHeaderInfo,
  ResolvedColumnPrefs,
  SortEntry,
  TableColumnDef,
  TableColumnMeta,
} from "./table/types";

export interface TableMetrics {
  /** Row height, applied as the cell minimum via `--tbl-row-h`. */
  rowHeight: number;
  /** Cell padding shorthand, applied via `--tbl-cell-pad`. */
  cellPadding: string;
  /** Body font size in px, applied via `--tbl-fs`. */
  fontSize: number;
  /**
   * Header font size in px. The shared header renderer pins its own size, so
   * the table re-applies this to mounted `<th>` nodes after a column change.
   */
  headerFontSize: number;
}

/**
 * `default` is the new comfortable rhythm. `dense` is the explicit opt-in for
 * screener / market tables — those numbers are a contract, do not drift them.
 */
export const TABLE_METRICS: Record<"default" | "comfortable" | "dense", TableMetrics> = {
  default: { rowHeight: 32, cellPadding: "8px 12px", fontSize: 12, headerFontSize: 11 },
  comfortable: { rowHeight: 36, cellPadding: "10px 14px", fontSize: 12, headerFontSize: 11 },
  dense: { rowHeight: 18, cellPadding: "1px 6px", fontSize: 10, headerFontSize: 10 },
};

export function TanStackTable<T>(props: TableProps<T>) {
  const densityApi = useDensity();
  const cols = useColumnPrefs(props);
  const isDense = () => props.dense ?? false;
  const isComfortable = () => densityApi.density() === "comfortable";
  const metrics = (): TableMetrics =>
    isDense()
      ? TABLE_METRICS.dense
      : isComfortable()
        ? TABLE_METRICS.comfortable
        : TABLE_METRICS.default;

  let tableEl: HTMLTableElement | undefined;
  createEffect(() => {
    const el = tableEl;
    if (!el) return;
    const m = metrics();
    el.style.setProperty("--tbl-row-h", `${m.rowHeight}px`);
    el.style.setProperty("--tbl-cell-pad", m.cellPadding);
    el.style.setProperty("--tbl-fs", `${m.fontSize}px`);
    // Re-derive on column changes so a newly mounted <th> (the renderer pins
    // 10px inline) picks up the same size as the cells it labels.
    const visibleIds = new Set(cols.visibleColumns().map((c) => String(c.id)));
    for (const th of el.querySelectorAll<HTMLElement>("thead th")) {
      if (visibleIds.has(th.id.replace("paper-tanstack-header-", ""))) {
        th.style.fontSize = `${m.headerFontSize}px`;
      }
    }
  });
  const sort = useSorting(props);
  const view = useColumnViews(props, {
    visibleColumns: cols.visibleColumns,
    sortedData: sort.sortedData,
  });
  const win = useRowWindow(props, {
    sortedData: sort.sortedData,
    visibleColumns: cols.visibleColumns,
    sorting: sort.sorting,
  });

  const ctx: TableRenderContext<T> = {
    props,
    visibleColumns: cols.visibleColumns,
    colCount: view.colCount,
    isNumeric: view.isNumeric,
    columnView: view.columnView,
    rowStyleBase: view.rowStyleBase,
    getValue,
    sorting: sort.sorting,
    enableSorting: sort.enableSorting,
    toggleSort: sort.toggleSort,
    isRowExpanded: win.isRowExpanded,
    toggleRow: win.toggleRow,
    isGroupExpanded: win.isGroupExpanded,
    toggleGroup: win.toggleGroup,
  };

  const showLoading = () => props.loading && props.data.length === 0;
  const showEmpty = () => !props.loading && props.data.length === 0;
  const emptyMessage = () => props.emptyMessage ?? "No data";

  const tableScroll = (
    <>
      <Show when={props.enableColumnControls}>
        <ToolbarRow
          justify="flex-end"
          wrap={false}
          className="px-2 shrink-0 border-b border-fin-border bg-fin-surface"
          style={{ height: "26px" }}
          data-testid="table-column-controls"
        >
          <ColumnPicker
            items={cols.columnPickerItems()}
            tableId={props.tableId}
            onMove={cols.moveColumnPref}
            onToggle={cols.toggleColumnPref}
            onReset={cols.resetColumnPrefs}
          />
        </ToolbarRow>
      </Show>
      <ScrollArea
        className="paper-tanstack-scroll"
        style={{ flex: 1, "min-height": "0px", overflow: "auto", display: "flex", "flex-direction": "column", "background-color": "var(--color-fin-surface)" }}
      >
        <table
          ref={(el: HTMLTableElement) => (tableEl = el)}
          data-testid={props.dataTestId}
          aria-label={props.ariaLabel}
          id={props.dataTestId ? `paper-tanstack-table-${props.dataTestId}` : undefined}
          style={view.tableStyle()}
          className={view.tableClassName()}
        >
        <thead>
          <tr>
            <For each={cols.visibleColumns()}>{(col) => renderHeader(col, ctx)}</For>
          </tr>
        </thead>
        <tbody>
          <Show
            when={showLoading()}
            fallback={
              <Show
                when={showEmpty()}
                fallback={(
                  <For each={win.visibleItems()}>{(item) => {
                    if (item.kind === "group") return renderGroupRow(item, ctx);
                    return renderRow(item, ctx);
                  }}</For>
                )}
              >
                <tr>
                  <td colSpan={view.colCount()}>
                    <div className="flex flex-col items-center justify-center py-3">
                      {props.emptyIcon}
                      <div className="text-xs c-dimmed">{emptyMessage()}</div>
                      {props.emptyAction}
                    </div>
                  </td>
                </tr>
              </Show>
            }
          >
            <tr>
              <td colSpan={view.colCount()}>
                <InlineLoader data-testid="table-loading-state" size="sm" message={props.loadingMessage} />
              </td>
            </tr>
          </Show>
        </tbody>
      </table>
      </ScrollArea>
      <Show when={win.hiddenCount() > 0}>
        <div
          class="flex items-center justify-between gap-2 px-2 h-[22px] shrink-0 border-t border-fin-border text-[10px] text-fin-text-muted font-mono tabular-nums"
          data-testid="table-window-footer"
        >
          <span>
            showing {win.visibleItems().length} of {win.bodyItems().length} · {win.hiddenCount()} not rendered
          </span>
          <Button
            size="xs"
            variant="subtle"
            data-testid="table-load-more"
            style={{ height: "20px" }}
            className="shrink-0"
            onClick={win.loadMore}
          >
            Load more
          </Button>
        </div>
      </Show>
    </>
  );

  if (props.bare) return tableScroll;

  const containerStyle: CSSProperties = {
    display: "flex",
    "flex-direction": "column",
    overflow: "hidden",
    "border-radius": "2px",
    border: "1px solid var(--color-fin-border)",
    "background-color": "var(--color-fin-surface)",
    "max-height": props.fillContainer ? undefined : "65vh",
    "min-height": props.fillContainer ? 0 : "200px",
    flex: props.fillContainer ? "1 1 0%" : undefined,
  };

  return (
    <Paper
      className={`paper-tanstack-container ${props.className || ""}`}
      id={props.dataTestId ? `paper-tanstack-${props.dataTestId}` : undefined}
      style={containerStyle}
    >
      {tableScroll}
    </Paper>
  );
}
