import { cn } from "../cn";
import type { CSSProperties } from "react";
import type { UIScrollAreaProps } from "../types";

const toSz = (v: unknown): string | undefined => (typeof v === "number" ? `${v}px` : (v as string | undefined));

export const ScrollArea = Object.assign(
  ({
    children, className, style, id, "data-testid": testId, h, w, type, offsetScrollbars, scrollbarSize, scrollHideDelay, onScrollPositionChange, ...rest
  }: UIScrollAreaProps & { onScrollPositionChange?: (pos: { x: number; y: number }) => void } & Record<string, unknown>) => {
    void type; void offsetScrollbars; void scrollbarSize; void scrollHideDelay;
    const styleObj: CSSProperties = {
      ...style,
      ...(h != null && { height: toSz(h) }),
      ...(w != null && { width: toSz(w) }),
    };
    return (
      <div
        id={id}
        className={cn("overflow-auto", className)}
        style={styleObj}
        data-testid={testId}
        onScroll={(e) => {
          if (onScrollPositionChange) {
            const t = e.currentTarget as HTMLElement;
            onScrollPositionChange({ x: t.scrollLeft, y: t.scrollTop });
          }
          (rest.onScroll as ((e: unknown) => void) | undefined)?.(e);
        }}
        {...rest}
      >
        {children}
      </div>
    );
  },
  { Autosize: ({ children, ...rest }: UIScrollAreaProps & Record<string, unknown>) => <div style={{ overflow: "auto" }} {...rest}>{children}</div> },
);
