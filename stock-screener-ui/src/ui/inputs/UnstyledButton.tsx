import ButtonBase from "@mui/material/ButtonBase";
import type { UIUnstyledButtonProps } from "../types";

export function UnstyledButton({ children, className, style, onClick, "data-testid": testId, ...rest }: UIUnstyledButtonProps) {
  return (
    <ButtonBase
      className={className}
      style={style as React.CSSProperties}
      onClick={onClick}
      data-testid={testId}
      sx={{
        justifyContent: "flex-start",
        textAlign: "left",
        font: "inherit",
        color: "inherit",
      }}
      {...(rest as object)}
    >
      {children}
    </ButtonBase>
  );
}
