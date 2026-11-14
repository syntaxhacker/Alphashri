import { splitProps } from "solid-js";
import { cn } from "../cn";
import * as palette from "../palette";
import type { JSX } from "solid-js";
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

const CODE_TAGS: Record<string, (props: any) => JSX.Element> = {
  pre: (props) => <pre {...props} />,
  code: (props) => <code {...props} />,
};

const CODE_KNOWN = [
  "children", "className", "style", "id", "data-testid", "block", "color",
] as const;
// `title` (inherited via UIBaseProps) is intentionally omitted: it flows through
// `rest` onto the DOM element as a native tooltip.

export function Code(props: UICodeProps & Record<string, unknown>) {
  const [known, rest] = splitProps(props, CODE_KNOWN);
  const colorValue = resolveColorValue(known.color as string | undefined);

  const baseStyle: Record<string, string | number | undefined> = {
    "font-size": "0.875em",
    padding: "2px 6px",
    "border-radius": "1px",
    ...(known.color != null ? { color: "white", ...(colorValue ? { "background-color": colorValue } : {}) } : {}),
  };

  const rootTag = known.block ? "pre" : "code";
  const Root = CODE_TAGS[rootTag];

  if (known.block) {
    return (
      <Root
        className={cn(known.className, "font-mono")}
        style={{
          ...baseStyle,
          display: "block",
          "overflow-x": "auto",
          padding: "12px",
          margin: 0,
          "white-space": "pre-wrap",
          "word-break": "break-word",
          ...(known.style as Record<string, unknown> | undefined),
        }}
        id={known.id}
        data-testid={known["data-testid"]}
        {...rest}
      >
        <code>{known.children}</code>
      </Root>
    );
  }

  return (
    <Root
      className={cn(known.className, "font-mono")}
      style={{ ...baseStyle, ...(known.style as Record<string, unknown> | undefined) }}
      id={known.id}
      data-testid={known["data-testid"]}
      {...rest}
    >
      {known.children}
    </Root>
  );
}
