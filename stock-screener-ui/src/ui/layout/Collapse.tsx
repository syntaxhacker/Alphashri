import { splitProps, type JSX } from "solid-js";
import { cn } from "../cn";
import type { UICollapseProps } from "../types";

export function Collapse(props: UICollapseProps & Record<string, unknown>) {
  // `timeout` is accepted for API compatibility but the height transition is
  // driven by `transitionDuration`; keep it off the DOM.
  const [, domRest] = splitProps(props, ["timeout"]);
  if (!props.in && props.unmountOnExit) return null;
  const duration = () => props.transitionDuration ?? 225;
  const timing = () => props.transitionTimingFunction ?? "ease";
  // An accessor, not a value: a frozen object left every consumer at its
  // mount-time state, so nothing ever expanded.
  const collapseStyle = (): JSX.CSSProperties => ({
    ...props.style,
    overflow: "hidden",
    height: props.in ? "auto" : "0px",
    transition: `height ${duration()}ms ${timing()}`,
  });
  return (
    <div
      id={props.id}
      className={cn(props.className)}
      style={collapseStyle()}
      data-testid={props["data-testid"]}
      aria-hidden={!props.in}
      {...domRest}
    >
      {props.children}
    </div>
  );
}
