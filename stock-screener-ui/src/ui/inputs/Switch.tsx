import MuiSwitch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import { alpha } from "@mui/material/styles";
import type { UISwitchProps } from "../types";
import * as palette from "../palette";

function mapSize(size: UISwitchProps["size"]): "small" | "medium" {
  switch (size) {
    case "xs":
    case "sm":
      return "small";
    case "md":
    case "lg":
    case "xl":
    default:
      return "medium";
  }
}

export function Switch({
  label,
  checked,
  defaultChecked,
  onChange,
  disabled,
  size,
  color,
  onLabel: _onLabel,
  offLabel: _offLabel,
  description,
  className,
  style,
  "data-testid": testId,
  id,
  children: _children,
  onClick: _onClick,
  onMouseEnter: _onMouseEnter,
  onMouseLeave: _onMouseLeave,
  ...rest
}: UISwitchProps) {
  const muiSize = mapSize(size);
  const onTone =
    color === "error" || color === "danger"
      ? palette.NEGATIVE
      : color === "info"
        ? palette.PRIMARY
        : palette.POSITIVE;
  const switchSx = {
    "& .MuiSwitch-switchBase": { color: palette.TEXT_MUTED },
    "& .MuiSwitch-switchBase.Mui-checked": { color: onTone },
    // The track must stay legible on the dark surface: a 1px border plus a
    // muted fill. A bare `palette.BORDER` track reads as a floating dot.
    "& .MuiSwitch-track": {
      backgroundColor: alpha(palette.TEXT_MUTED, 0.22),
      opacity: 1,
      border: `1px solid ${palette.BORDER}`,
      boxSizing: "border-box",
    },
    "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": {
      backgroundColor: alpha(onTone, 0.45),
      opacity: 1,
    },
    "& .MuiSwitch-switchBase.Mui-disabled + .MuiSwitch-track": { opacity: 0.35 },
  };

  const control = (
    <MuiSwitch
      checked={checked}
      defaultChecked={defaultChecked}
      onChange={onChange}
      disabled={disabled}
      size={muiSize}
      color={(color === "error" || color === "danger" ? "error" : color === "info" || color === "success" || color === "success" ? "success" : "primary") as never}
      id={id}
      slotProps={{ input: { "data-testid": testId } as never } as never}
      sx={[switchSx, ...(style ? [style as Record<string, unknown>] : [])]}
      {...(rest as any)}
    />
  );

  if (!label && !description) {
    return (
      <Box className={className} data-testid={testId ? `${testId}-wrapper` : undefined} sx={style ? { display: "inline-flex" } : undefined}>
        {control}
      </Box>
    );
  }

  const labelNode = (
    <Box sx={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
      {label ? <Typography variant="body2" component="span">{label}</Typography> : null}
      {description ? (
        <Typography variant="caption" color="text.secondary" component="span">
          {description}
        </Typography>
      ) : null}
    </Box>
  );

  return (
    <FormGroup className={className} style={style} data-testid={testId ? `${testId}-group` : undefined}>
      <FormControlLabel
        control={control}
        label={labelNode}
        disabled={disabled}
        data-testid={testId ? `${testId}-label` : undefined}
        sx={{ m: 0, alignItems: description ? "flex-start" : "center" }}
      />
    </FormGroup>
  );
}
