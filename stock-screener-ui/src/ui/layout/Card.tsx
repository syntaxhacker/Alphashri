import { splitProps } from "solid-js";
import type { JSX } from "solid-js";
import { cn } from "../cn";
import type { UICardProps } from "../types";

const sp = (v: unknown): string | undefined => {
  if (v == null) return undefined;
  if (typeof v === "number") return `${v}px`;
  const m: Record<string, string> = { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" };
  return (m[v as string] ?? v) as string;
};
const toSz = (v: unknown): string | undefined => (typeof v === "number" ? `${v}px` : (v as string | undefined));
const rad = (v: unknown): string | undefined => {
  if (v == null) return undefined;
  if (typeof v === "number") return `${v}px`;
  const m: Record<string, string> = { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" };
  return (m[v as string] ?? v) as string;
};

const CARD_KNOWN = [
  "children", "className", "style", "id", "data-testid", "testId", "onClick",
  "p", "px", "py", "pt", "pb", "pl", "pr", "m", "mx", "my", "mt", "mb", "ml", "mr",
  "bg", "c", "opacity", "pos", "top", "right", "bottom", "left",
  "w", "h", "miw", "maw", "mih", "mah", "flex",
  "shadow", "radius", "padding", "component",
] as const;

export function Card(props: UICardProps & Record<string, unknown>) {
  const [known, rest] = splitProps(props, CARD_KNOWN);
  void known.shadow;

  const testId = known["data-testid"] ?? (known.testId as string | undefined);
  const pad = known.padding ?? known.p;

  const styleObj: Record<string, string | number | undefined> = {};
  if (known.radius != null) styleObj["border-radius"] = rad(known.radius);
  if (pad != null) styleObj.padding = sp(pad);
  if (known.padding == null && known.px != null) { styleObj["padding-left"] = sp(known.px); styleObj["padding-right"] = sp(known.px); }
  if (known.padding == null && known.py != null) { styleObj["padding-top"] = sp(known.py); styleObj["padding-bottom"] = sp(known.py); }
  if (known.padding == null && known.pt != null) styleObj["padding-top"] = sp(known.pt);
  if (known.padding == null && known.pb != null) styleObj["padding-bottom"] = sp(known.pb);
  if (known.padding == null && known.pl != null) styleObj["padding-left"] = sp(known.pl);
  if (known.padding == null && known.pr != null) styleObj["padding-right"] = sp(known.pr);
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
  if (known.w != null) styleObj.width = toSz(known.w);
  if (known.h != null) styleObj.height = toSz(known.h);
  if (known.miw != null) styleObj["min-width"] = toSz(known.miw);
  if (known.maw != null) styleObj["max-width"] = toSz(known.maw);
  if (known.mih != null) styleObj["min-height"] = toSz(known.mih);
  if (known.mah != null) styleObj["max-height"] = toSz(known.mah);
  if (known.flex != null) styleObj.flex = known.flex as unknown as string;

// Solid compiles `<Tag>` to `createComponent(Tag, ...)`, which calls the
// value as a function. A string tag is not callable, so dynamic elements go
// through an intrinsic registry instead.
const CARD_TAGS: Record<string, (p: any) => JSX.Element> = {
  div: (p) => <div {...p} />,
  section: (p) => <section {...p} />,
  article: (p) => <article {...p} />,
  aside: (p) => <aside {...p} />,
  header: (p) => <header {...p} />,
  footer: (p) => <footer {...p} />,
  main: (p) => <main {...p} />,
  form: (p) => <form {...p} />,
  figure: (p) => <figure {...p} />,
};

  // Dynamic element: a plain string is not callable in Solid, so resolve it
  // through the intrinsic registry (see above).
  const Tag = CARD_TAGS[(known.component as string) ?? "article"] ?? CARD_TAGS["article"];


  return (
    <Tag
      id={known.id}
      className={cn("bg-fin-surface", known.className)}
      style={styleObj}
      data-testid={testId}
      onClick={known.onClick}
      {...rest}
    >
      {known.children}
    </Tag>
  );
}
