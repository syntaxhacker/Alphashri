import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import type { UICodeProps } from "../types";

export function Code({ children, block, color, className, style, "data-testid": testId, id, ...rest }: UICodeProps) {
  const sx: Record<string, unknown> = {
    fontFamily: "monospace",
    fontSize: "0.875em",
    px: 0.75,
    py: 0.25,
    borderRadius: 1,
    bgcolor: color ? (color as string) : "action.hover",
    ...(color ? { color: "common.white" } : {}),
  };

  if (block) {
    return (
      <Box
        component="pre"
        className={className}
        style={style}
        id={id}
        data-testid={testId}
        sx={{
          ...sx,
          display: "block",
          overflowX: "auto",
          p: 1.5,
          m: 0,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
        {...(rest as Record<string, unknown>)}
      >
        <code>{children}</code>
      </Box>
    );
  }

  return (
    <Typography
      component="code"
      className={className}
      style={style}
      id={id}
      data-testid={testId}
      sx={sx}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </Typography>
  );
}
