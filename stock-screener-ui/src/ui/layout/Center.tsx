import MuiBox from "@mui/material/Box";
import type { UICenterProps } from "../types";

export function Center({ children, className, style, id, "data-testid": testId, inline, ...rest }: UICenterProps & Record<string, unknown>) {
  return (
    <MuiBox
      id={id as string}
      className={className}
      style={style}
      data-testid={testId}
      sx={{ display: inline ? "inline-flex" : "flex", alignItems: "center", justifyContent: "center" }}
      {...rest}
    >{children}</MuiBox>
  );
}
