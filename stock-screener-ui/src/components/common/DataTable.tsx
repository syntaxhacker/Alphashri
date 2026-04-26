import type { CSSProperties, ReactNode } from "react";
import { Table } from "@mantine/core";

interface DataTableProps {
  children: ReactNode;
  striped?: boolean;
  highlightOnHover?: boolean;
  withTableBorder?: boolean;
  withColumnBorders?: boolean;
  stickyHeader?: boolean;
  verticalSpacing?: "xs" | "sm" | "md";
  horizontalSpacing?: "xs" | "sm" | "md";
  className?: string;
  id?: string;
  dataTestId?: string;
  style?: CSSProperties;
  styles?: Partial<
    Record<"table" | "thead" | "tbody" | "tfoot" | "tr" | "th" | "td" | "caption", CSSProperties>
  >;
}

export function DataTable({
  children,
  striped = true,
  highlightOnHover = true,
  withTableBorder = false,
  withColumnBorders = false,
  stickyHeader = false,
  verticalSpacing = "xs",
  horizontalSpacing = "sm",
  className,
  id,
  dataTestId,
  style,
  styles,
}: DataTableProps) {
  return (
    <Table
      striped={striped}
      highlightOnHover={highlightOnHover}
      withTableBorder={withTableBorder}
      withColumnBorders={withColumnBorders}
      stickyHeader={stickyHeader}
      verticalSpacing={verticalSpacing}
      horizontalSpacing={horizontalSpacing}
      className={className}
      id={id}
      data-testid={dataTestId}
      style={style}
      styles={styles}
    >
      {children}
    </Table>
  );
}
