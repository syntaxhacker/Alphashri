import type { JSX } from "solid-js";
import { EChartsHost } from "../charts/EChartsHost";

/**
 * Thin alias kept for existing paper-trading callers. The shared host owns
 * the lazy load, init, setOption, resize and dispose lifecycle. `option` is a
 * thunk evaluated inside the host's tracking scope, so it re-applies when any
 * signal the builder reads changes.
 */
export function EChartSolid(props: {
  option: () => Record<string, unknown>;
  style?: JSX.CSSProperties;
  class?: string;
  "data-testid"?: string;
}) {
  return (
    <EChartsHost
      option={props.option}
      class={props.class ?? "w-full"}
      style={props.style}
      data-testid={props["data-testid"]}
    />
  );
}
