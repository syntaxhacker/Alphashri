import MuiPaper from "@mui/material/Paper";
import type { UIPaperProps } from "../types";

const sp = (v: unknown) => {
  if (v == null) return undefined;
  if (typeof v === "number") return `${v}px`;
  const m: Record<string, string> = { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" };
  return (m[v as string] ?? v) as string;
};
const toSz = (v: unknown) => (typeof v === "number" ? `${v}px` : (v as string | undefined));
const rad = (v: unknown) => {
  if (v == null) return undefined;
  if (typeof v === "number") return `${v}px`;
  const m: Record<string, string> = { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" };
  return (m[v as string] ?? v) as string;
};

export function Paper({
  children, className, style, id, "data-testid": testId, onClick,
  p, px, py, pt, pb, pl, pr, m, mx, my, mt, mb, ml, mr, bg, c, opacity, pos, top, right, bottom, left, w, h, miw, maw, mih, mah, flex,
  shadow, radius, withBorder, ...rest
}: UIPaperProps & Record<string, unknown>) {
  void shadow;
  return (
    <MuiPaper
      elevation={0} id={id as string} className={className} style={style} data-testid={testId} onClick={onClick as never}
      sx={{
        ...(withBorder && { border: "1px solid", borderColor: "divider" }),
        ...(radius != null && { borderRadius: rad(radius) }),
        ...(p != null && { p: sp(p) }), ...(px != null && { px: sp(px) }), ...(py != null && { py: sp(py) }),
        ...(pt != null && { pt: sp(pt) }), ...(pb != null && { pb: sp(pb) }), ...(pl != null && { pl: sp(pl) }), ...(pr != null && { pr: sp(pr) }),
        ...(m != null && { m: sp(m) }), ...(mx != null && { mx: sp(mx) }), ...(my != null && { my: sp(my) }),
        ...(mt != null && { mt: sp(mt) }), ...(mb != null && { mb: sp(mb) }), ...(ml != null && { ml: sp(ml) }), ...(mr != null && { mr: sp(mr) }),
        ...(bg != null && { bgcolor: bg as string }), ...(c != null && { color: c as string }),
        ...(opacity != null && { opacity }), ...(pos && { position: pos }),
        ...(top != null && { top: toSz(top) }), ...(right != null && { right: toSz(right) }),
        ...(bottom != null && { bottom: toSz(bottom) }), ...(left != null && { left: toSz(left) }),
        ...(w != null && { width: toSz(w) }), ...(h != null && { height: toSz(h) }),
        ...(miw != null && { minWidth: toSz(miw) }), ...(maw != null && { maxWidth: toSz(maw) }),
        ...(mih != null && { minHeight: toSz(mih) }), ...(mah != null && { maxHeight: toSz(mah) }),
        ...(flex != null && { flex: flex as string }),
      }}
      {...rest}
    >{children}</MuiPaper>
  );
}
