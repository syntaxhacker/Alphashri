import type { JSX } from "solid-js";
import { Text, Badge } from "@/ui";
import { getPnLTextColor } from "../../utils/ui-helpers";

interface PnlTextProps {
  value: number;
  children?: JSX.Element;
  size?: string;
  fw?: number | string;
  span?: boolean;
  ml?: number | string;
  fs?: string;
  /** Opt out of the mono numeral face (e.g. when embedding in prose). */
  mono?: boolean;
  className?: string;
  "data-testid"?: string;
}

export function PnlText(props: PnlTextProps) {
  const className = () =>
    [props.mono === false ? "" : "font-mono tabular-nums", props.className ?? ""].filter(Boolean).join(" ");
  return (
    <Text
      c={getPnLTextColor(props.value)}
      fw={props.fw ?? 600}
      size={props.size}
      span={props.span}
      ml={props.ml}
      fs={props.fs}
      className={className()}
      style={{ "font-variant-numeric": "tabular-nums" }}
      data-testid={props["data-testid"]}
    >
      {props.children ?? (props.value >= 0 ? `+${props.value}` : `${props.value}`)}
    </Text>
  );
}

interface PnlBadgeProps {
  value: number;
  children?: string;
  size?: string;
  "data-testid"?: string;
}

export function PnlBadge(props: PnlBadgeProps) {
  return (
    <Badge color={getPnLTextColor(props.value)} variant="filled" size={props.size} data-testid={props["data-testid"]}>
      {props.children ?? (props.value >= 0 ? `+${props.value}` : `${props.value}`)}
    </Badge>
  );
}
