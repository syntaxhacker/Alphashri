import MuiCollapse from "@mui/material/Collapse";
import type { UICollapseProps } from "../types";

export function Collapse({ children, className, style, id, "data-testid": testId, in: open, transitionDuration, transitionTimingFunction, onTransitionEnd, ...rest }: UICollapseProps & Record<string, unknown>) {
  return (
    <MuiCollapse
      in={open} timeout={transitionDuration} easing={transitionTimingFunction as never}
      onEntered={onTransitionEnd as never} onExited={onTransitionEnd as never}
      className={className} style={style} id={id as string} data-testid={testId} {...rest}
    >{children}</MuiCollapse>
  );
}
