import ButtonBase from "@mui/material/ButtonBase";
import type { UIUnstyledButtonProps } from "../types";

export function UnstyledButton({ children, className, style, onClick, "data-testid": testId, sx, ...rest }: UIUnstyledButtonProps & { sx?: any }) {
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
        ...(sx as object),
      }}
      {...(rest as object)}
    >
      {children}
    </ButtonBase>
  );
}
