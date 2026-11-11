import type * as React from "react";
import { cn } from "../cn";
import type { UIFlexProps } from "../types";

const sp = (v: unknown) => {
  if (v == null) return undefined;
  if (typeof v === "number") return `${v}px`;
  const m: Record<string, string> = { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" };
  return (m[v as string] ?? v) as string;
};
const toSz = (v: unknown) => (typeof v === "number" ? `${v}px` : (v as string | undefined));

export function Flex({
  children, className, style, id, "data-testid": testId, onClick, onMouseEnter, onMouseLeave,
  p, px, py, pt, pb, pl, pr, m, mx, my, mt, mb, ml, mr, bg, c, opacity, pos, top, right, bottom, left, inset, w, h, miw, maw, mih, mah, flex,
  direction, wrap, justify, align, gap, alignItems, justifyContent, flexDirection, spacing,
  component, elevation: _elevation, variant: _variant,
  ...rest
}: UIFlexProps & Record<string, unknown>) {
  const styleObj: React.CSSProperties = {
    display: "flex",
    ...(flexDirection ?? direction ? { flexDirection: flexDirection ?? direction } : {}),
    ...(wrap && { flexWrap: wrap }),
    ...(justifyContent ?? justify ? { justifyContent: justifyContent ?? justify } : {}),
    ...(alignItems ?? align ? { alignItems: alignItems ?? align } : {}),
    ...(spacing != null && { gap: typeof spacing === "number" ? `${spacing * 8}px` : sp(spacing) }),
    ...(gap != null && { gap: sp(gap) }),
    ...(p != null && { padding: sp(p) }),
    ...(px != null && { paddingLeft: sp(px), paddingRight: sp(px) }),
    ...(py != null && { paddingTop: sp(py), paddingBottom: sp(py) }),
    ...(pt != null && { paddingTop: sp(pt) }),
    ...(pb != null && { paddingBottom: sp(pb) }),
    ...(pl != null && { paddingLeft: sp(pl) }),
    ...(pr != null && { paddingRight: sp(pr) }),
    ...(m != null && { margin: sp(m) }),
    ...(mx != null && { marginLeft: sp(mx), marginRight: sp(mx) }),
    ...(my != null && { marginTop: sp(my), marginBottom: sp(my) }),
    ...(mt != null && { marginTop: sp(mt) }),
    ...(mb != null && { marginBottom: sp(mb) }),
    ...(ml != null && { marginLeft: sp(ml) }),
    ...(mr != null && { marginRight: sp(mr) }),
    ...(bg != null && { backgroundColor: bg as string }),
    ...(c != null && { color: c as string }),
    ...(opacity != null && { opacity }),
    ...(pos && { position: pos }),
    ...(top != null && { top: toSz(top) }),
    ...(right != null && { right: toSz(right) }),
    ...(bottom != null && { bottom: toSz(bottom) }),
    ...(left != null && { left: toSz(left) }),
    ...(inset != null && { inset: toSz(inset) }),
    ...(w != null && { width: toSz(w) }),
    ...(h != null && { height: toSz(h) }),
    ...(miw != null && { minWidth: toSz(miw) }),
    ...(maw != null && { maxWidth: toSz(maw) }),
    ...(mih != null && { minHeight: toSz(mih) }),
    ...(mah != null && { maxHeight: toSz(mah) }),
    ...(flex != null && { flex: flex as string }),
  };

  void _elevation; void _variant;
  const Tag = (component ?? "div") as React.ElementType;

  return (
    <Tag
      id={id as string}
      className={cn(className)}
      style={{ ...styleObj, ...style }}
      data-testid={testId}
      onClick={onClick as never}
      onMouseEnter={onMouseEnter as never}
      onMouseLeave={onMouseLeave as never}
      {...rest}
    >
      {children}
    </Tag>
  );
}
