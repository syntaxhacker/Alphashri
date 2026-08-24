import MuiAlert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import type { UIAlertProps } from "../types";

function mapSeverity(color: UIAlertProps["color"]): "success" | "error" | "warning" | "info" {
  if (!color) return "info";
  switch (color) {
    case "success":
      return "success";
    case "error":
    case "danger":
      return "error";
    case "warning":
      return "warning";
    case "primary":
    case "secondary":
    case "info":
      return "info";
    default:
      return "info";
  }
}

function mapVariant(variant: UIAlertProps["variant"]): "filled" | "outlined" | "standard" {
  switch (variant) {
    case "filled":
      return "filled";
    case "outline":
      return "outlined";
    case "light":
    case "default":
    case "transparent":
    default:
      return "standard";
  }
}

export function Alert({
  icon,
  title,
  withCloseButton,
  onClose,
  children,
  className,
  style,
  "data-testid": testId,
  id,
  variant,
  color,
  radius,
  ...rest
}: UIAlertProps) {
  const severity = mapSeverity(color);
  const muiVariant = mapVariant(variant);

  return (
    <MuiAlert
      severity={severity}
      variant={muiVariant}
      icon={icon as never}
      onClose={withCloseButton ? onClose : undefined}
      className={className}
      style={style}
      id={id}
      data-testid={testId}
      sx={{
        ...(radius != null
          ? {
              borderRadius:
                typeof radius === "number"
                  ? `${radius}px`
                  : radius === "xs"
                    ? "4px"
                    : radius === "xl"
                      ? "16px"
                      : undefined,
            }
          : {}),
      }}
      {...(rest as Record<string, unknown>)}
    >
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      {children}
    </MuiAlert>
  );
}
