import { splitProps } from "solid-js";
import { cn } from "../cn";
import type { UIBoxProps } from "../types";

const sp = (v: unknown) => {
  if (v == null) return undefined;
  if (typeof v === "number") return `${v}px`;
  const m: Record<string, string> = { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" };
  return (m[v as string] ?? v) as string;
};
const toSz = (v: unknown) => (typeof v === "number" ? `${v}px` : (v as string | undefined));

const BOX_KNOWN = [
  "children", "className", "style", "id", "data-testid", "onClick", "onMouseEnter", "onMouseLeave",
  "p", "px", "py", "pt", "pb", "pl", "pr", "m", "mx", "my", "mt", "mb", "ml", "mr",
  "bg", "c", "opacity", "pos", "top", "right", "bottom", "left", "inset",
  "w", "h", "miw", "maw", "mih", "mah", "flex",
  "alignItems", "justifyContent", "flexDirection", "gap", "spacing", "component",
] as const;

export function Box(props: UIBoxProps & Record<string, unknown> & { alignItems?: unknown; justifyContent?: unknown; flexDirection?: unknown; gap?: unknown }) {
  const [known, rest] = splitProps(props, BOX_KNOWN);

  const styleObj: Record<string, string | number | undefined> = {};
  if (known.p != null) styleObj.padding = sp(known.p);
  if (known.px != null) { styleObj.paddingLeft = sp(known.px); styleObj.paddingRight = sp(known.px); }
  if (known.py != null) { styleObj.paddingTop = sp(known.py); styleObj.paddingBottom = sp(known.py); }
  if (known.pt != null) styleObj.paddingTop = sp(known.pt);
  if (known.pb != null) styleObj.paddingBottom = sp(known.pb);
  if (known.pl != null) styleObj.paddingLeft = sp(known.pl);
  if (known.pr != null) styleObj.paddingRight = sp(known.pr);
  if (known.m != null) styleObj.margin = sp(known.m);
  if (known.mx != null) { styleObj.marginLeft = sp(known.mx); styleObj.marginRight = sp(known.mx); }
  if (known.my != null) { styleObj.marginTop = sp(known.my); styleObj.marginBottom = sp(known.my); }
  if (known.mt != null) styleObj.marginTop = sp(known.mt);
  if (known.mb != null) styleObj.marginBottom = sp(known.mb);
  if (known.ml != null) styleObj.marginLeft = sp(known.ml);
  if (known.mr != null) styleObj.marginRight = sp(known.mr);
  if (known.bg != null) styleObj.backgroundColor = known.bg as string;
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
  if (known.miw != null) styleObj.minWidth = toSz(known.miw);
  if (known.maw != null) styleObj.maxWidth = toSz(known.maw);
  if (known.mih != null) styleObj.minHeight = toSz(known.mih);
  if (known.mah != null) styleObj.maxHeight = toSz(known.mah);
  if (known.flex != null) styleObj.flex = known.flex as string;
  if (known.alignItems != null) styleObj.alignItems = known.alignItems as string;
  if (known.justifyContent != null) styleObj.justifyContent = known.justifyContent as string;
  if (known.flexDirection != null) styleObj.flexDirection = known.flexDirection as string;
  if (known.gap != null) styleObj.gap = sp(known.gap);
  if (known.spacing != null && known.gap == null) {
    styleObj.gap = typeof known.spacing === "number" ? `${known.spacing * 8}px` : sp(known.spacing);
  }

  const Tag = (known.component ?? "div") as string;

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
