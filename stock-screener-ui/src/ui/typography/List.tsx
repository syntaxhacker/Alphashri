import { cn } from "../cn";
import type { ReactNode } from "react";
import type { UIListProps, UIListItemProps } from "../types";

const sizeMap: Record<string, string> = {
  xs: "0.75rem",
  sm: "0.875rem",
  md: "1rem",
  lg: "1.125rem",
  xl: "1.25rem",
};

export function List({
  children,
  type,
  withPadding,
  size,
  spacing: _spacing,
  listStyleType,
  center,
  icon,
  className,
  style,
  id,
  "data-testid": testId,
  ...rest
}: UIListProps) {
  // `icon` is kept for API parity; per-item icons are rendered by List.Item.
  void icon;

  const isOrdered = type === "ordered";
  const styleObj: React.CSSProperties = {
    margin: 0,
    padding: 0,
    ...(withPadding ? { paddingLeft: "24px" } : { paddingLeft: "0px" }),
    listStylePosition: "inside",
    ...(size != null && { fontSize: sizeMap[size as string] ?? (size as string) }),
    ...(listStyleType && { listStyleType: listStyleType as string }),
    ...(center && { textAlign: "center" }),
    ...(isOrdered ? {} : { listStyleType: listStyleType ?? "disc" }),
  };
  const Element = isOrdered ? "ol" : "ul";

  return (
    <Element
      className={cn(className)}
      style={{ ...styleObj, ...style }}
      id={id}
      data-testid={testId}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </Element>
  );
}

export function ListItem({
  children,
  className,
  style,
  id,
  "data-testid": testId,
  icon,
  ...rest
}: UIListItemProps & { icon?: ReactNode }) {
  return (
    <li
      className={cn(className)}
      style={style}
      id={id}
      data-testid={testId}
      {...(rest as Record<string, unknown>)}
    >
      {icon ? <span>{icon}</span> : null}
      {children}
    </li>
  );
}

List.Item = ListItem;
