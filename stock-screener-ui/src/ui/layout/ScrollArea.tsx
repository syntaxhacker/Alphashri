import MuiBox from "@mui/material/Box";
import type { UIScrollAreaProps } from "../types";

const toSz = (v: unknown) => (typeof v === "number" ? `${v}px` : (v as string | undefined));

export const ScrollArea = Object.assign(
  ({ children, className, style, id, "data-testid": testId, h, w, type, offsetScrollbars, scrollbarSize, scrollHideDelay, onScrollPositionChange, ...rest }: UIScrollAreaProps & { onScrollPositionChange?: (pos: { x: number; y: number }) => void } & Record<string, unknown>) => {
    void type; void offsetScrollbars; void scrollbarSize; void scrollHideDelay;
    return (
      <MuiBox
        id={id as string} className={className} style={style} data-testid={testId}
        onScroll={(e) => {
          if (onScrollPositionChange) {
            const t = e.currentTarget as HTMLElement;
            onScrollPositionChange({ x: t.scrollLeft, y: t.scrollTop });
          }
          (rest.onScroll as ((e: unknown) => void) | undefined)?.(e);
        }}
        sx={{ overflow: "auto", ...(h != null && { height: toSz(h) }), ...(w != null && { width: toSz(w) }) }}
        {...rest}
      >{children}</MuiBox>
    );
  },
  { Autosize: ({ children, ...rest }: UIScrollAreaProps & Record<string, unknown>) => <MuiBox sx={{ overflow: "auto" }} {...rest}>{children}</MuiBox> },
);
