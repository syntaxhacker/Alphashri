import { cn } from "../cn";
import * as palette from "../palette";
import type { UICodeProps } from "../types";

const BG_MAP: Record<string, string> = {
  primary: palette.PRIMARY,
  secondary: palette.TEXT_MUTED,
  success: palette.POSITIVE,
  error: palette.NEGATIVE,
  warning: palette.WARNING,
  info: palette.INFO,
  danger: palette.NEGATIVE,
  dimmed: palette.TEXT_MUTED,
  default: palette.TEXT,
};

function resolveColorValue(v: string | undefined): string | undefined {
  if (!v) return undefined;
  if (v.startsWith("#") || v.startsWith("rgb") || v.includes(".")) return v;
  return BG_MAP[v];
}

export function Code({
  children,
  block,
  color,
  className,
  style,
  id,
  "data-testid": testId,
  ...rest
}: UICodeProps) {
  const colorValue = resolveColorValue(color as string | undefined);
  const baseStyle: React.CSSProperties = {
    fontSize: "0.875em",
    padding: "2px 6px",
    borderRadius: "1px",
    ...(color != null ? { color: "white", ...(colorValue ? { backgroundColor: colorValue } : {}) } : {}),
  };

  if (block) {
    const blockStyle: React.CSSProperties = {
      ...baseStyle,
      display: "block",
      overflowX: "auto",
      padding: "12px",
      margin: 0,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
    };
    return (
      <pre
        className={cn(className, "font-mono")}
        style={{ ...blockStyle, ...style }}
        id={id}
        data-testid={testId}
        {...(rest as Record<string, unknown>)}
      >
        <code>{children}</code>
      </pre>
    );
  }

  return (
    <code
      className={cn(className, "font-mono")}
      style={{ ...baseStyle, ...style }}
      id={id}
      data-testid={testId}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </code>
  );
}
