import type { JSX } from "solid-js";
import { BadgeCell, NumCell, SymbolCell, TextCell } from "@/components/common/tableCells";
import type { TableColumnDef } from "@/components/common/TanStackTable";

/**
 * Column factories.
 *
 * 44 files used to declare their own `const columns` with hand-rolled cells and
 * an align that sometimes disagreed with the cell. These factories make the
 * align, the type treatment and the testid impossible to get wrong: pick the
 * factory for the data, pass the accessor and an optional formatter.
 *
 * Rule of thumb:
 *   symbol / name  → symbolColumn / textColumn
 *   any number     → numColumn   (mono, tabular, right)
 *   status / flag  → badgeColumn (centred)
 *   sparkline      → sparkColumn
 */

interface BaseOpts<T> {
  id: string;
  header: TableColumnDef<T>["header"];
  /** Defaults to `id`. */
  accessor?: keyof T | ((row: T) => unknown);
  size?: number;
  title?: string;
}

function accessorFor<T>(opts: BaseOpts<T>) {
  const acc = opts.accessor ?? (opts.id as keyof T);
  if (typeof acc === "function") return { accessorFn: acc as (row: T) => unknown };
  return { accessorKey: acc as string };
}

export interface SymbolColumnOpts<T> extends BaseOpts<T> {
  name?: (row: T) => string | null | undefined;
  onOpen?: (symbol: string) => void;
  cellTestId?: (row: T) => string;
}

/** Symbol over company name. The identity column never truncates away. */
export function symbolColumn<T>(opts: SymbolColumnOpts<T>): TableColumnDef<T> {
  return {
    id: opts.id,
    header: opts.header,
    ...accessorFor(opts),
    size: opts.size ?? 176,
    meta: { align: "left" },
    cell: ({ row }) => (
      <SymbolCell
        symbol={String((row.original as Record<string, unknown>)[opts.id] ?? "")}
        name={opts.name?.(row.original)}
        onOpen={opts.onOpen}
        testId={opts.cellTestId?.(row.original)}
      />
    ),
  } as TableColumnDef<T>;
}

export interface NumColumnOpts<T> extends BaseOpts<T> {
  format?: (value: number) => string;
  /** Colour green/red by sign. */
  signed?: boolean;
  dash?: string;
  fw?: number;
  tone?: "default" | "dimmed" | "success" | "error" | "warning" | "primary";
  cellTestId?: (row: T) => string;
}

/** Any numeric column: mono, tabular, right-aligned. */
export function numColumn<T>(opts: NumColumnOpts<T>): TableColumnDef<T> {
  return {
    id: opts.id,
    header: opts.header,
    ...accessorFor(opts),
    size: opts.size ?? 80,
    meta: { align: "right" },
    cell: ({ row }) => {
      const raw = (row.original as Record<string, unknown>)[opts.id];
      const value = typeof raw === "number" ? raw : raw == null ? null : Number(raw);
      return (
        <NumCell
          value={value}
          signed={opts.signed}
          format={opts.format}
          dash={opts.dash}
          fw={opts.fw}
          tone={opts.tone}
          title={opts.title}
          testId={opts.cellTestId?.(row.original)}
        />
      );
    },
  } as TableColumnDef<T>;
}

export interface TextColumnOpts<T> extends BaseOpts<T> {
  dimmed?: boolean;
  fw?: number;
  mono?: boolean;
  text?: (row: T) => string | null | undefined;
  cellTestId?: (row: T) => string;
}

/** Free text: left-aligned, truncating. */
export function textColumn<T>(opts: TextColumnOpts<T>): TableColumnDef<T> {
  return {
    id: opts.id,
    header: opts.header,
    ...accessorFor(opts),
    size: opts.size ?? 140,
    meta: { align: "left" },
    cell: ({ row }) => (
      <TextCell
        value={opts.text?.(row.original) ?? String((row.original as Record<string, unknown>)[opts.id] ?? "")}
        dimmed={opts.dimmed}
        fw={opts.fw}
        mono={opts.mono}
        title={opts.title}
        testId={opts.cellTestId?.(row.original)}
      />
    ),
  } as TableColumnDef<T>;
}

export interface BadgeColumnOpts<T> extends BaseOpts<T> {
  label: (row: T) => string;
  color?: (row: T) => string | undefined;
  variant?: "filled" | "light" | "outline" | "dot" | "default";
  cellTestId?: (row: T) => string;
}

/** Status / flag pill: centred. */
export function badgeColumn<T>(opts: BadgeColumnOpts<T>): TableColumnDef<T> {
  return {
    id: opts.id,
    header: opts.header,
    ...accessorFor(opts),
    size: opts.size ?? 96,
    meta: { align: "center" },
    cell: ({ row }) => (
      <BadgeCell
        label={opts.label(row.original)}
        color={opts.color?.(row.original)}
        variant={opts.variant}
        testId={opts.cellTestId?.(row.original)}
        title={opts.title}
      />
    ),
  } as TableColumnDef<T>;
}

export interface SparkColumnOpts<T> extends BaseOpts<T> {
  render: (row: T) => JSX.Element;
  cellTestId?: (row: T) => string;
}

/** Fixed-width visual cell (sparkline, mini chart): centred, not sortable. */
export function sparkColumn<T>(opts: SparkColumnOpts<T>): TableColumnDef<T> {
  return {
    id: opts.id,
    header: opts.header,
    ...accessorFor(opts),
    size: opts.size ?? 64,
    meta: { align: "center" },
    enableSorting: false,
    cell: ({ row }) => (
      <div class="flex items-center justify-center min-w-0" data-testid={opts.cellTestId?.(row.original)}>
        {opts.render(row.original)}
      </div>
    ),
  } as TableColumnDef<T>;
}
