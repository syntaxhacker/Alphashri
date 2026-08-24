import MuiCard from "@mui/material/Card";
import type { UICardProps } from "../types";

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

export function Card({
  children, className, style, id, "data-testid": testId, onClick,
  p, px, py, pt, pb, pl, pr, m, mx, my, mt, mb, ml, mr, bg, c, opacity, pos, top, right, bottom, left, w, h, miw, maw, mih, mah, flex,
  shadow, radius, padding, ...rest
}: UICardProps & Record<string, unknown>) {
  void shadow;
  const pad = padding ?? p;
  return (
    <MuiCard
      elevation={1} id={id as string} className={className} style={style} data-testid={testId} onClick={onClick as never}
      sx={{
        ...(radius != null && { borderRadius: rad(radius) }),
        ...(pad != null && { p: sp(pad) }),
        ...(padding == null && px != null && { px: sp(px) }), ...(padding == null && py != null && { py: sp(py) }),
        ...(padding == null && pt != null && { pt: sp(pt) }), ...(padding == null && pb != null && { pb: sp(pb) }),
        ...(padding == null && pl != null && { pl: sp(pl) }), ...(padding == null && pr != null && { pr: sp(pr) }),
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
    >{children}</MuiCard>
  );
}
