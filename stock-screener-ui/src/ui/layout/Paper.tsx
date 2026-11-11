import { cn } from "../cn";
import type { CSSProperties } from "react";
import type * as React from "react";
import type { UIPaperProps } from "../types";

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

export function Paper({
  children, className, style, id, "data-testid": testId, testId: testIdAlias, onClick,
  p, px, py, pt, pb, pl, pr, m, mx, my, mt, mb, ml, mr, bg, c, opacity, pos, top, right, bottom, left, w, h, miw, maw, mih, mah, flex,
  shadow, radius, component, elevation: _elevation, variant: _variant, alignItems: _alignItems, spacing: _spacing, ...rest
}: UIPaperProps & Record<string, unknown>) {
  void shadow; void _elevation; void _variant; void _alignItems; void _spacing;
  const styleObj: CSSProperties = {
    ...style,
    ...(radius != null && { borderRadius: rad(radius) }),
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
    ...(w != null && { width: toSz(w) }),
    ...(h != null && { height: toSz(h) }),
    ...(miw != null && { minWidth: toSz(miw) }),
    ...(maw != null && { maxWidth: toSz(maw) }),
    ...(mih != null && { minHeight: toSz(mih) }),
    ...(mah != null && { maxHeight: toSz(mah) }),
    ...(flex != null && { flex: flex as unknown as string }),
  };
  const Tag = (component ?? "section") as React.ElementType;

  return (
    <Tag
      id={id}
      className={cn("bg-fin-surface", className)}
      style={styleObj}
      data-testid={testId ?? (testIdAlias as string | undefined)}
      onClick={onClick as never}
      {...rest}
    >
      {children}
    </Tag>
  );
}
