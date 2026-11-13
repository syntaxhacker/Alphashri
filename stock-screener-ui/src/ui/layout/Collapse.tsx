import { splitProps } from "solid-js";
import { cn } from "../cn";
import type { UICollapseProps } from "../types";

export function Collapse(props: UICollapseProps & Record<string, unknown>) {
  // `timeout` is accepted for API compatibility but the height transition is
  // driven by `transitionDuration`; keep it off the DOM.
  const [, domRest] = splitProps(props, ["timeout"]);
  if (!props.in && props.unmountOnExit) return null;
  const duration = props.transitionDuration ?? 225;
  const timing = props.transitionTimingFunction ?? "ease";
  const styleObj: Record<string, string | number | undefined> = {
    ...props.style,
    overflow: "hidden",
    height: props.in ? "auto" : 0,
    transition: `height ${duration}ms ${timing}`,
  };
  return (
    <div
      id={props.id}
      className={cn(props.className)}
      style={styleObj}
      data-testid={props["data-testid"]}
      aria-hidden={!props.in}
      {...domRest}
    >
      {props.children}
    </div>
  );
}
