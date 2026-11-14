import { splitProps } from "solid-js";
import type { JSX } from "solid-js";
import { cn } from "../cn";
import type { UIStackProps } from "../types";

const sp = (v: unknown) => {
  if (v == null) return undefined;
  if (typeof v === "number") return `${v}px`;
  const m: Record<string, string> = { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" };
  return (m[v as string] ?? v) as string;
};
const toSz = (v: unknown) => (typeof v === "number" ? `${v}px` : (v as string | undefined));

const STACK_KNOWN = [
  "children", "className", "style", "id", "data-testid", "onClick", "onMouseEnter", "onMouseLeave",
  "p", "px", "py", "pt", "pb", "pl", "pr", "m", "mx", "my", "mt", "mb", "ml", "mr",
  "bg", "c", "opacity", "pos", "top", "right", "bottom", "left", "inset",
  "w", "h", "miw", "maw", "mih", "mah", "flex",
  "direction", "wrap", "justify", "align", "gap", "alignItems", "justifyContent", "flexDirection", "spacing",
  "component",
] as const;

export function Stack(props: UIStackProps & Record<string, unknown>) {
  const [known, rest] = splitProps(props, STACK_KNOWN);

  // Stack always renders `display: flex` and defaults to `column` direction;
  // replicate both here since a plain div has neither by default.
  const styleObj: Record<string, string | number | undefined> = {
    display: "flex",
    "flex-direction": (known.flexDirection as string | undefined) ?? (known.direction as string | undefined) ?? "column",
  };
  if (known.wrap) styleObj["flex-wrap"] = known.wrap as string;
  if (known.justifyContent != null) styleObj["justify-content"] = known.justifyContent as string | undefined;
  else if (known.justify != null) styleObj["justify-content"] = known.justify;
  if (known.alignItems != null) styleObj["align-items"] = known.alignItems as string | undefined;
  else if (known.align != null) styleObj["align-items"] = known.align;
  if (known.spacing != null) styleObj.gap = typeof known.spacing === "number" ? `${known.spacing * 8}px` : sp(known.spacing);
  if (known.gap != null) styleObj.gap = sp(known.gap);
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
  if (known.opacity != null) styleObj.opacity = known.opacity;
  if (known.pos != null) styleObj.position = known.pos;
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

// Solid compiles `<Tag>` to `createComponent(Tag, ...)`, which calls the
// value as a function. A string tag is not callable, so dynamic elements go
// through an intrinsic registry instead.
const STACK_TAGS: Record<string, (p: any) => JSX.Element> = {
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
};

  // Dynamic element: a plain string is not callable in Solid, so resolve it
  // through the intrinsic registry (see above).
  const Tag = STACK_TAGS[(known.component as string) ?? "div"] ?? STACK_TAGS["div"];


  return (
    <Tag
      id={known.id}
      className={cn(known.className)}
      style={{ ...styleObj, ...known.style }}
      data-testid={known["data-testid"]}
      onClick={known.onClick}
      onMouseEnter={known.onMouseEnter}
      onMouseLeave={known.onMouseLeave}
      {...rest}
    >
      {known.children}
    </Tag>
  );
}
