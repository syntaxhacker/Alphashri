import MuiDivider from "@mui/material/Divider";
import type { UIDividerProps } from "../types";

export function Divider({ children, className, style, id, "data-testid": testId, orientation, color, size, label, labelPosition, ...rest }: UIDividerProps & Record<string, unknown>) {
  void color; void size;
  const orient = orientation === "vertical" ? "vertical" : "horizontal";
  const textAlign = (labelPosition as never) ?? "center";
  return (
    <MuiDivider id={id as string} className={className} style={style} data-testid={testId} orientation={orient} textAlign={textAlign} {...rest}>
      {label ?? children}
    </MuiDivider>
  );
}
