import { Show, splitProps } from "solid-js";
import { cn } from "../cn";
import type { JSX } from "solid-js";
import type { UIListProps, UIListItemProps } from "../types";

const sizeMap: Record<string, string> = {
  xs: "0.75rem",
  sm: "0.875rem",
  md: "1rem",
  lg: "1.125rem",
  xl: "1.25rem",
};

const LIST_TAGS: Record<string, (props: any) => JSX.Element> = {
  ol: (props) => <ol {...props} />,
  ul: (props) => <ul {...props} />,
};

export function List(props: UIListProps & Record<string, unknown>) {
  const [known, rest] = splitProps(props, [
    "children", "className", "style", "id", "data-testid", "type", "withPadding", "size",
    "spacing", "listStyleType", "center", "icon",
  ] as const);
  // `icon` is kept for API parity; per-item icons are rendered by List.Item.
  void known.icon;
  void known.spacing;

  const rootTag = known.type === "ordered" ? "ol" : "ul";
  const Root = LIST_TAGS[rootTag];

  return (
    <Root
      className={cn(known.className)}
      style={{
        margin: 0,
        padding: 0,
        ...(known.withPadding ? { paddingLeft: "24px" } : { paddingLeft: "0px" }),
        listStylePosition: "inside",
        ...(known.size != null ? { fontSize: sizeMap[known.size as string] ?? (known.size as string) } : {}),
        ...(known.listStyleType ? { listStyleType: known.listStyleType } : {}),
        ...(known.center ? { textAlign: "center" } : {}),
        ...(known.type === "ordered" ? {} : { listStyleType: known.listStyleType ?? "disc" }),
        ...(known.style as Record<string, unknown> | undefined),
      }}
      id={known.id}
      data-testid={known["data-testid"]}
      {...rest}
    >
      {known.children}
    </Root>
  );
}

export function ListItem(props: UIListItemProps & { icon?: JSX.Element }) {
  const [known, rest] = splitProps(props, [
    "children", "className", "style", "id", "data-testid", "icon",
  ] as const);

  return (
    <li
      className={cn(known.className)}
      style={known.style}
      id={known.id}
      data-testid={known["data-testid"]}
      {...rest}
    >
      <Show when={known.icon}><span>{known.icon}</span></Show>
      {known.children}
    </li>
  );
}

List.Item = ListItem;
