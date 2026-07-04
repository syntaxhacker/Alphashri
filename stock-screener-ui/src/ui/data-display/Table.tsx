import { Table as MantineTable } from "@mantine/core";
import type { UITableProps } from "../types";

export function Table({ striped, highlightOnHover, withTableBorder, withColumnBorders, stickyHeader, stickyHeaderOffset, verticalSpacing, horizontalSpacing, variant, children, className, style, "data-testid": testId, ...rest }: UITableProps) {
  return <MantineTable striped={striped} highlightOnHover={highlightOnHover} withTableBorder={withTableBorder} withColumnBorders={withColumnBorders} stickyHeader={stickyHeader} stickyHeaderOffset={stickyHeaderOffset} verticalSpacing={verticalSpacing} horizontalSpacing={horizontalSpacing} variant={variant} className={className} style={style} data-testid={testId} {...rest}>{children}</MantineTable>;
}

export function TableThead({ children, className, style, "data-testid": testId, ...rest }: UITableProps) {
  return <MantineTable.Thead className={className} style={style} data-testid={testId} {...rest}>{children}</MantineTable.Thead>;
}

export function TableTbody({ children, className, style, "data-testid": testId, ...rest }: UITableProps) {
  return <MantineTable.Tbody className={className} style={style} data-testid={testId} {...rest}>{children}</MantineTable.Tbody>;
}

export function TableTr({ children, className, style, "data-testid": testId, onClick, ...rest }: UITableProps) {
  return <MantineTable.Tr className={className} style={style} data-testid={testId} onClick={onClick} {...rest}>{children}</MantineTable.Tr>;
}

export function TableTh({ children, className, style, "data-testid": testId, onClick, ...rest }: UITableProps) {
  return <MantineTable.Th className={className} style={style} data-testid={testId} onClick={onClick} {...rest}>{children}</MantineTable.Th>;
}

export function TableTd({ children, className, style, "data-testid": testId, onClick, ...rest }: UITableProps) {
  return <MantineTable.Td className={className} style={style} data-testid={testId} onClick={onClick} {...rest}>{children}</MantineTable.Td>;
}
Table.Thead = TableThead;
Table.Tbody = TableTbody;
Table.Tr = TableTr;
Table.Th = TableTh;
Table.Td = TableTd;
