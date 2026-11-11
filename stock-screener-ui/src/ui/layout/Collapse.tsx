import { cn } from "../cn";
import type { CSSProperties } from "react";
import type { UICollapseProps } from "../types";

export function Collapse({ children, className, style, id, "data-testid": testId, in: open, transitionDuration, transitionTimingFunction, onTransitionEnd, ...rest }: UICollapseProps & Record<string, unknown>) {
  const { timeout, unmountOnExit, ...domRest } = rest;
  void timeout;
  if (!open && unmountOnExit) return null;
  const duration = transitionDuration ?? 225;
  const timing = transitionTimingFunction ?? "ease";
  const styleObj: CSSProperties = {
    ...style,
    overflow: "hidden",
    height: open ? "auto" : 0,
    transition: `height ${duration}ms ${timing}`,
  };
  return (
    <div
      id={id}
      className={cn(className)}
      style={styleObj}
      data-testid={testId}
      aria-hidden={!open}
      onTransitionEnd={onTransitionEnd}
      {...domRest}
    >
      {children}
    </div>
  );
}
