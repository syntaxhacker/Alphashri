import { TanStackTable as CommonTanStackTable, type TableProps } from "../common/TanStackTable";

export type {
  GroupHeaderInfo,
  SortEntry,
  TableColumnDef,
  TableColumnMeta,
} from "../common/TanStackTable";

/**
 * Compatibility surface for paper-trading / replay callers. Rendering, sorting,
 * grouping, selection and windowing all live in the common table; the flags
 * below only restore this table family's historical defaults.
 */
export function TanStackTable<T>(props: TableProps<T>) {
  return (
    <CommonTanStackTable<T>
      {...props}
      metricsPreset={props.metricsPreset ?? "paper"}
      defaultGroupExpanded={props.defaultGroupExpanded ?? true}
      getGroupKey={props.getGroupKey ?? ((value) => String(value))}
      remountChangedRows={props.remountChangedRows ?? true}
    />
  );
}
