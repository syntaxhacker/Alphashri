import { splitProps } from "solid-js";
import { Dynamic } from "solid-js/web";
import { cn } from "@/ui";
import type { JSX } from "solid-js";

// Solid compiles `<Tag>` to `createComponent(Tag, ...)`, which calls the value
// as a function. A string tag is not callable, so dynamic elements resolve
// through an intrinsic registry instead.
const TAG_REGISTRY: Record<string, (p: any) => JSX.Element> = {
  div: (p) => <div {...p} />,
  span: (p) => <span {...p} />,
  section: (p) => <section {...p} />,
  article: (p) => <article {...p} />,
  aside: (p) => <aside {...p} />,
  header: (p) => <header {...p} />,
  footer: (p) => <footer {...p} />,
  main: (p) => <main {...p} />,
  nav: (p) => <nav {...p} />,
  ul: (p) => <ul {...p} />,
  ol: (p) => <ol {...p} />,
  li: (p) => <li {...p} />,
  form: (p) => <form {...p} />,
  p: (p) => <p {...p} />,
  figure: (p) => <figure {...p} />,
  figcaption: (p) => <figcaption {...p} />,
  label: (p) => <label {...p} />,
  a: (p) => <a {...p} />,
  button: (p) => <button {...p} />,
  h1: (p) => <h1 {...p} />,
  h2: (p) => <h2 {...p} />,
  h3: (p) => <h3 {...p} />,
  h4: (p) => <h4 {...p} />,
  h5: (p) => <h5 {...p} />,
  h6: (p) => <h6 {...p} />,
};

/**
 * Local layout primitives matching the `@/ui` Box/Stack/Flex/Group/Card/Paper
 * props and spacing arithmetic. The `@/ui` versions render a dynamic intrinsic
 * via `<Tag>` with a string, which Solid cannot resolve (Comp is not a
 * function), so my scope renders the same styles through `<Dynamic>`.
 */

const sp = (v: unknown) => {
  if (v == null) return undefined;
  if (typeof v === "number") return `${v}px`;
  const m: Record<string, string> = { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" };
  return (m[v as string] ?? v) as string;
};
const toSz = (v: unknown) => (typeof v === "number" ? `${v}px` : (v as string | undefined));
const rad = (v: unknown) => sp(v);

const BOX_KNOWN = [
  "children", "className", "style", "id", "data-testid", "onClick", "onMouseEnter", "onMouseLeave",
  "p", "px", "py", "pt", "pb", "pl", "pr", "m", "mx", "my", "mt", "mb", "ml", "mr",
  "bg", "c", "opacity", "pos", "top", "right", "bottom", "left", "inset",
  "w", "h", "miw", "maw", "mih", "mah", "flex",
  "alignItems", "justifyContent", "flexDirection", "gap", "spacing", "component",
] as const;

function boxStyle(known: Record<string, unknown>, styleObj: Record<string, string | number | undefined>) {
  if (known.p != null) styleObj.padding = sp(known.p);
  if (known.px != null) { styleObj["padding-left"] = sp(known.px); styleObj["padding-right"] = sp(known.px); }
  if (known.py != null) { styleObj["padding-top"] = sp(known.py); styleObj["padding-bottom"] = sp(known.py); }
  if (known.pt != null) styleObj["padding-top"] = sp(known.pt);
  if (known.pb != null) styleObj["padding-bottom"] = sp(known.pb);
  if (known.pl != null) styleObj["padding-left"] = sp(known.pl);
  if (known.pr != null) styleObj["padding-right"] = sp(known.pr);
  if (known.m != null) styleObj.margin = sp(known.m);
  if (known.mx != null) { styleObj["margin-left"] = sp(known.mx); styleObj["margin-right"] = sp(known.mx); }
  if (known.my != null) { styleObj["margin-top"] = sp(known.my); styleObj["margin-bottom"] = sp(known.my); }
  if (known.mt != null) styleObj["margin-top"] = sp(known.mt);
  if (known.mb != null) styleObj["margin-bottom"] = sp(known.mb);
  if (known.ml != null) styleObj["margin-left"] = sp(known.ml);
  if (known.mr != null) styleObj["margin-right"] = sp(known.mr);
  if (known.bg != null) styleObj["background-color"] = known.bg as string;
  if (known.c != null) styleObj.color = known.c as string;
  if (known.opacity != null) styleObj.opacity = known.opacity as number;
  if (known.pos != null) styleObj.position = known.pos as string;
  if (known.top != null) styleObj.top = toSz(known.top);
  if (known.right != null) styleObj.right = toSz(known.right);
  if (known.bottom != null) styleObj.bottom = toSz(known.bottom);
  if (known.left != null) styleObj.left = toSz(known.left);
  if (known.inset != null) styleObj.inset = toSz(known.inset);
  if (known.w != null) styleObj.width = toSz(known.w);
  if (known.h != null) styleObj.height = toSz(known.h);
  if (known.miw != null) styleObj["min-width"] = toSz(known.miw);
  if (known.maw != null) styleObj["max-width"] = toSz(known.maw);
  if (known.mih != null) styleObj["min-height"] = toSz(known.mih);
  if (known.mah != null) styleObj["max-height"] = toSz(known.mah);
  if (known.flex != null) styleObj.flex = known.flex as string;
  if (known.alignItems != null) styleObj["align-items"] = known.alignItems as string;
  if (known.justifyContent != null) styleObj["justify-content"] = known.justifyContent as string;
  if (known.flexDirection != null) styleObj["flex-direction"] = known.flexDirection as string;
  if (known.gap != null) styleObj.gap = sp(known.gap);
  if (known.spacing != null && known.gap == null) {
    styleObj.gap = typeof known.spacing === "number" ? `${(known.spacing as number) * 8}px` : sp(known.spacing);
  }
}

export function Box(props: Record<string, unknown> & { children?: JSX.Element }) {
  const [known, rest] = splitProps(props as never, BOX_KNOWN) as [Record<string, unknown>, Record<string, unknown>];
  const styleObj: Record<string, string | number | undefined> = {};
  boxStyle(known, styleObj);
  // Resolved through the intrinsic registry: a bare string is not callable.
  const Tag = TAG_REGISTRY[(known.component as string) ?? "div"] ?? TAG_REGISTRY["div"];
  return (
    <Dynamic
      component={Tag}
      id={known.id as string | undefined}
      class={cn(known.className as string | undefined)}
      style={{ ...styleObj, ...(known.style as Record<string, unknown> | undefined) }}
      data-testid={known["data-testid"] as string | undefined}
      onClick={known.onClick as JSX.EventHandlerUnion<HTMLElement, MouseEvent> | undefined}
      onMouseEnter={known.onMouseEnter as JSX.EventHandlerUnion<HTMLElement, MouseEvent> | undefined}
      onMouseLeave={known.onMouseLeave as JSX.EventHandlerUnion<HTMLElement, MouseEvent> | undefined}
      {...rest}
    >
      {known.children as JSX.Element}
    </Dynamic>
  );
}

const FLEX_KNOWN = [
  ...BOX_KNOWN.filter((k) => k !== "alignItems" && k !== "justifyContent" && k !== "flexDirection"),
  "direction", "wrap", "justify", "align",
] as const;

export function Flex(props: Record<string, unknown> & { children?: JSX.Element }) {
  const [known, rest] = splitProps(props as never, FLEX_KNOWN) as [Record<string, unknown>, Record<string, unknown>];
  const styleObj: Record<string, string | number | undefined> = {
    display: "flex",
    "flex-direction": (known.flexDirection as string | undefined) ?? (known.direction as string | undefined) ?? "row",
  };
  if (known.wrap != null) styleObj["flex-wrap"] = known.wrap as string;
  else styleObj["flex-wrap"] = "wrap";
  if (known.justify != null) styleObj["justify-content"] = known.justify as string;
  if (known.align != null) styleObj["align-items"] = known.align as string;
  boxStyle(known, styleObj);
  return (
    <Dynamic
      component="div"
      id={known.id as string | undefined}
      class={cn(known.className as string | undefined)}
      style={{ ...styleObj, ...(known.style as Record<string, unknown> | undefined) }}
      data-testid={known["data-testid"] as string | undefined}
      onClick={known.onClick as JSX.EventHandlerUnion<HTMLElement, MouseEvent> | undefined}
      onMouseEnter={known.onMouseEnter as JSX.EventHandlerUnion<HTMLElement, MouseEvent> | undefined}
      onMouseLeave={known.onMouseLeave as JSX.EventHandlerUnion<HTMLElement, MouseEvent> | undefined}
      {...rest}
    >
      {known.children as JSX.Element}
    </Dynamic>
  );
}

const STACK_KNOWN = [
  "children", "className", "style", "id", "data-testid", "onClick", "onMouseEnter", "onMouseLeave",
  "p", "px", "py", "pt", "pb", "pl", "pr", "m", "mx", "my", "mt", "mb", "ml", "mr",
  "bg", "c", "opacity", "pos", "top", "right", "bottom", "left", "inset",
  "w", "h", "miw", "maw", "mih", "mah", "flex",
  "direction", "wrap", "justify", "align", "gap", "alignItems", "justifyContent", "flexDirection", "spacing", "component",
] as const;

export function Stack(props: Record<string, unknown> & { children?: JSX.Element }) {
  const [known, rest] = splitProps(props as never, STACK_KNOWN) as [Record<string, unknown>, Record<string, unknown>];
  const styleObj: Record<string, string | number | undefined> = {
    display: "flex",
    "flex-direction": (known.flexDirection as string | undefined) ?? (known.direction as string | undefined) ?? "column",
  };
  if (known.wrap != null) styleObj["flex-wrap"] = known.wrap as string;
  if (known.justifyContent != null) styleObj["justify-content"] = known.justifyContent as string;
  else if (known.justify != null) styleObj["justify-content"] = known.justify as string;
  if (known.alignItems != null) styleObj["align-items"] = known.alignItems as string;
  else if (known.align != null) styleObj["align-items"] = known.align as string;
  if (known.spacing != null) styleObj.gap = typeof known.spacing === "number" ? `${(known.spacing as number) * 8}px` : sp(known.spacing);
  if (known.gap != null) styleObj.gap = sp(known.gap);
  boxStyle(known, styleObj);
  // Resolved through the intrinsic registry: a bare string is not callable.
  const Tag = TAG_REGISTRY[(known.component as string) ?? "div"] ?? TAG_REGISTRY["div"];
  return (
    <Dynamic
      component={Tag}
      id={known.id as string | undefined}
      class={cn(known.className as string | undefined)}
      style={{ ...styleObj, ...(known.style as Record<string, unknown> | undefined) }}
      data-testid={known["data-testid"] as string | undefined}
      onClick={known.onClick as JSX.EventHandlerUnion<HTMLElement, MouseEvent> | undefined}
      onMouseEnter={known.onMouseEnter as JSX.EventHandlerUnion<HTMLElement, MouseEvent> | undefined}
      onMouseLeave={known.onMouseLeave as JSX.EventHandlerUnion<HTMLElement, MouseEvent> | undefined}
      {...rest}
    >
      {known.children as JSX.Element}
    </Dynamic>
  );
}

const GROUP_KNOWN = [
  "children", "className", "style", "id", "data-testid", "onClick", "onMouseEnter", "onMouseLeave",
  "p", "px", "py", "pt", "pb", "pl", "pr", "m", "mx", "my", "mt", "mb", "ml", "mr",
  "bg", "c", "opacity", "pos", "top", "right", "bottom", "left", "inset",
  "w", "h", "miw", "maw", "mih", "mah", "flex",
  "direction", "wrap", "justify", "align", "gap", "alignItems", "justifyContent", "flexDirection", "spacing",
  "grow", "preventGrowOverflow", "component",
] as const;

export function Group(props: Record<string, unknown> & { children?: JSX.Element }) {
  const [known, rest] = splitProps(props as never, GROUP_KNOWN) as [Record<string, unknown>, Record<string, unknown>];
  void known.grow; void known.preventGrowOverflow;

  const styleObj: Record<string, string | number | undefined> = {
    display: "flex",
    "flex-direction": (known.flexDirection as string | undefined) ?? (known.direction as string | undefined) ?? "row",
    "flex-wrap": (known.wrap as string | undefined) ?? "wrap",
  };
  if (known.justifyContent != null) styleObj["justify-content"] = known.justifyContent as string;
  else if (known.justify != null) styleObj["justify-content"] = known.justify as string;
  if (known.alignItems != null) styleObj["align-items"] = known.alignItems as string;
  else if (known.align != null) styleObj["align-items"] = known.align as string;
  if (known.spacing != null) styleObj.gap = typeof known.spacing === "number" ? `${(known.spacing as number) * 8}px` : sp(known.spacing);
  if (known.gap != null) styleObj.gap = sp(known.gap);
  boxStyle(known, styleObj);
  // Resolved through the intrinsic registry: a bare string is not callable.
  const Tag = TAG_REGISTRY[(known.component as string) ?? "div"] ?? TAG_REGISTRY["div"];
  return (
    <Dynamic
      component={Tag}
      id={known.id as string | undefined}
      class={cn(known.className as string | undefined)}
      style={{ ...styleObj, ...(known.style as Record<string, unknown> | undefined) }}
      data-testid={known["data-testid"] as string | undefined}
      onClick={known.onClick as JSX.EventHandlerUnion<HTMLElement, MouseEvent> | undefined}
      onMouseEnter={known.onMouseEnter as JSX.EventHandlerUnion<HTMLElement, MouseEvent> | undefined}
      onMouseLeave={known.onMouseLeave as JSX.EventHandlerUnion<HTMLElement, MouseEvent> | undefined}
      {...rest}
    >
      {known.children as JSX.Element}
    </Dynamic>
  );
}

const CARD_KNOWN = [
  "children", "className", "style", "id", "data-testid", "testId", "onClick",
  "p", "px", "py", "pt", "pb", "pl", "pr", "m", "mx", "my", "mt", "mb", "ml", "mr",
  "bg", "c", "opacity", "pos", "top", "right", "bottom", "left",
  "w", "h", "miw", "maw", "mih", "mah", "flex",
  "shadow", "radius", "padding", "component",
] as const;

export function Card(props: Record<string, unknown> & { children?: JSX.Element }) {
  const [known, rest] = splitProps(props as never, CARD_KNOWN) as [Record<string, unknown>, Record<string, unknown>];
  void known.shadow;

  const testId = (known["data-testid"] ?? known.testId) as string | undefined;
  const pad = known.padding ?? known.p;

  const styleObj: Record<string, string | number | undefined> = {};
  if (known.radius != null) styleObj["border-radius"] = rad(known.radius);
  if (pad != null) styleObj.padding = sp(pad);
  if (known.padding == null && known.p == null) {
    if (known.px != null) { styleObj["padding-left"] = sp(known.px); styleObj["padding-right"] = sp(known.px); }
    if (known.py != null) { styleObj["padding-top"] = sp(known.py); styleObj["padding-bottom"] = sp(known.py); }
    if (known.pt != null) styleObj["padding-top"] = sp(known.pt);
    if (known.pb != null) styleObj["padding-bottom"] = sp(known.pb);
    if (known.pl != null) styleObj["padding-left"] = sp(known.pl);
    if (known.pr != null) styleObj["padding-right"] = sp(known.pr);
  }
  if (known.m != null) styleObj.margin = sp(known.m);
  if (known.mx != null) { styleObj["margin-left"] = sp(known.mx); styleObj["margin-right"] = sp(known.mx); }
  if (known.my != null) { styleObj["margin-top"] = sp(known.my); styleObj["margin-bottom"] = sp(known.my); }
  if (known.mt != null) styleObj["margin-top"] = sp(known.mt);
  if (known.mb != null) styleObj["margin-bottom"] = sp(known.mb);
  if (known.ml != null) styleObj["margin-left"] = sp(known.ml);
  if (known.mr != null) styleObj["margin-right"] = sp(known.mr);
  if (known.bg != null) styleObj["background-color"] = known.bg as string;
  if (known.c != null) styleObj.color = known.c as string;
  if (known.opacity != null) styleObj.opacity = known.opacity as number;
  if (known.pos != null) styleObj.position = known.pos as string;
  if (known.top != null) styleObj.top = toSz(known.top);
  if (known.right != null) styleObj.right = toSz(known.right);
  if (known.bottom != null) styleObj.bottom = toSz(known.bottom);
  if (known.left != null) styleObj.left = toSz(known.left);
  if (known.w != null) styleObj.width = toSz(known.w);
  if (known.h != null) styleObj.height = toSz(known.h);
  if (known.miw != null) styleObj["min-width"] = toSz(known.miw);
  if (known.maw != null) styleObj["max-width"] = toSz(known.maw);
  if (known.mih != null) styleObj["min-height"] = toSz(known.mih);
  if (known.mah != null) styleObj["max-height"] = toSz(known.mah);
  if (known.flex != null) styleObj.flex = known.flex as string;

  const Tag = TAG_REGISTRY[(known.component as string) ?? "article"] ?? TAG_REGISTRY["article"];
  return (
    <Dynamic
      component={Tag}
      id={known.id as string | undefined}
      class={cn("bg-fin-surface", known.className as string | undefined)}
      style={styleObj}
      data-testid={testId}
      onClick={known.onClick as JSX.EventHandlerUnion<HTMLElement, MouseEvent> | undefined}
      {...rest}
    >
      {known.children as JSX.Element}
    </Dynamic>
  );
}

const PAPER_KNOWN = [
  "children", "className", "style", "id", "data-testid", "testId", "onClick",
  "p", "px", "py", "pt", "pb", "pl", "pr", "m", "mx", "my", "mt", "mb", "ml", "mr",
  "bg", "c", "opacity", "pos", "top", "right", "bottom", "left",
  "w", "h", "miw", "maw", "mih", "mah", "flex",
  "shadow", "radius", "component",
] as const;

export function Paper(props: Record<string, unknown> & { children?: JSX.Element }) {
  const [known, rest] = splitProps(props as never, PAPER_KNOWN) as [Record<string, unknown>, Record<string, unknown>];
  void known.shadow;

  const testId = (known["data-testid"] ?? known.testId) as string | undefined;

  const styleObj: Record<string, string | number | undefined> = {};
  if (known.radius != null) styleObj["border-radius"] = rad(known.radius);
  if (known.p != null) styleObj.padding = sp(known.p);
  if (known.px != null) { styleObj["padding-left"] = sp(known.px); styleObj["padding-right"] = sp(known.px); }
  if (known.py != null) { styleObj["padding-top"] = sp(known.py); styleObj["padding-bottom"] = sp(known.py); }
  if (known.pt != null) styleObj["padding-top"] = sp(known.pt);
  if (known.pb != null) styleObj["padding-bottom"] = sp(known.pb);
  if (known.pl != null) styleObj["padding-left"] = sp(known.pl);
  if (known.pr != null) styleObj["padding-right"] = sp(known.pr);
  if (known.m != null) styleObj.margin = sp(known.m);
  if (known.mx != null) { styleObj["margin-left"] = sp(known.mx); styleObj["margin-right"] = sp(known.mx); }
  if (known.my != null) { styleObj["margin-top"] = sp(known.my); styleObj["margin-bottom"] = sp(known.my); }
  if (known.mt != null) styleObj["margin-top"] = sp(known.mt);
  if (known.mb != null) styleObj["margin-bottom"] = sp(known.mb);
  if (known.ml != null) styleObj["margin-left"] = sp(known.ml);
  if (known.mr != null) styleObj["margin-right"] = sp(known.mr);
  if (known.bg != null) styleObj["background-color"] = known.bg as string;
  if (known.c != null) styleObj.color = known.c as string;
  if (known.opacity != null) styleObj.opacity = known.opacity as number;
  if (known.pos != null) styleObj.position = known.pos as string;
  if (known.top != null) styleObj.top = toSz(known.top);
  if (known.right != null) styleObj.right = toSz(known.right);
  if (known.bottom != null) styleObj.bottom = toSz(known.bottom);
  if (known.left != null) styleObj.left = toSz(known.left);
  if (known.w != null) styleObj.width = toSz(known.w);
  if (known.h != null) styleObj.height = toSz(known.h);
  if (known.miw != null) styleObj["min-width"] = toSz(known.miw);
  if (known.maw != null) styleObj["max-width"] = toSz(known.maw);
  if (known.mih != null) styleObj["min-height"] = toSz(known.mih);
  if (known.mah != null) styleObj["max-height"] = toSz(known.mah);
  if (known.flex != null) styleObj.flex = known.flex as string;

  const Tag = TAG_REGISTRY[(known.component as string) ?? "section"] ?? TAG_REGISTRY["section"];
  return (
    <Dynamic
      component={Tag}
      id={known.id as string | undefined}
      class={cn("bg-fin-surface", known.className as string | undefined)}
      style={styleObj}
      data-testid={testId}
      onClick={known.onClick as JSX.EventHandlerUnion<HTMLElement, MouseEvent> | undefined}
      {...rest}
    >
      {known.children as JSX.Element}
    </Dynamic>
  );
}
