import { List as MantineList } from "@mantine/core";
import type { UIListProps, UIListItemProps } from "../types";

export function List({ children, type, withPadding, size, spacing, listStyleType, center, icon, className, style, "data-testid": testId }: UIListProps) {
  return <MantineList type={type} withPadding={withPadding} size={size} spacing={spacing} listStyleType={listStyleType} center={center} icon={icon as any} className={className} style={style} data-testid={testId}>{children}</MantineList>;
}

export function ListItem({ children, className, style, "data-testid": testId }: UIListItemProps) {
  return <MantineList.Item className={className} style={style} data-testid={testId}>{children}</MantineList.Item>;
}
List.Item = ListItem;
