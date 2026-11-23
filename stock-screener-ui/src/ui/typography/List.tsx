import { Show, splitProps } from "solid-js";
import { cn } from "../cn";
import { TYPE_CLASS, type TypeRole } from "../typography";
import type { JSX } from "solid-js";
import type { UIListProps, UIListItemProps } from "../types";

/** Body copy tops out at `heading`; see Text for the shared-alias rationale. */
const SIZE_ROLE: Record<string, TypeRole> = {
  xs: "micro",
  sm: "label",
  md: "title",
  lg: "heading",
  xl: "heading",
};

function sizeClass(size: UIListProps["size"]): string | undefined {
  if (size == null) return undefined;
  const role = SIZE_ROLE[String(size)];
  return role ? TYPE_CLASS[role] : undefined;
}

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
      className={cn(known.className, sizeClass(known.size))}
      style={{
        margin: 0,
        padding: 0,
        ...(known.withPadding ? { "padding-left": "24px" } : { "padding-left": "0px" }),
        "list-style-position": "inside",
        ...(known.listStyleType ? { "list-style-type": known.listStyleType } : {}),
        ...(known.center ? { "text-align": "center" } : {}),
        ...(known.type === "ordered" ? {} : { "list-style-type": known.listStyleType ?? "disc" }),
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
