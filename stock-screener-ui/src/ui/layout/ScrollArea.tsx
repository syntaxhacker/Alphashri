import { splitProps } from "solid-js";
import { cn } from "../cn";
import type { UIScrollAreaProps } from "../types";

const toSz = (v: unknown): string | undefined => (typeof v === "number" ? `${v}px` : (v as string | undefined));

const SCROLL_AREA_KNOWN = [
  "children", "className", "style", "id", "data-testid", "h", "w", "onScroll", "onScrollPositionChange",
] as const;

export const ScrollArea = Object.assign(
  (props: UIScrollAreaProps & Record<string, unknown>) => {
    const [known, rest] = splitProps(props, SCROLL_AREA_KNOWN);
    void known.type; void known.offsetScrollbars; void known.scrollbarSize; void known.scrollHideDelay;

    return (
      <div
        id={known.id}
        className={cn("overflow-auto", known.className)}
        style={{
          ...(known.style as Record<string, unknown> | undefined),
          ...(known.h != null ? { height: toSz(known.h) } : {}),
          ...(known.w != null ? { width: toSz(known.w) } : {}),
        }}
        data-testid={known["data-testid"]}
        onScroll={(e) => {
          if (known.onScrollPositionChange) {
            const t = e.currentTarget as HTMLElement;
            known.onScrollPositionChange({ x: t.scrollLeft, y: t.scrollTop });
          }
          known.onScroll?.(e);
        }}
        {...rest}
      >
        {known.children}
      </div>
    );
  },
  {
    Autosize: (props: UIScrollAreaProps & Record<string, unknown>) => {
      const [known, rest] = splitProps(props, ["children", "style", "className"] as const);
      return (
        <div
          style={{ overflow: "auto", ...(known.style as Record<string, unknown> | undefined) }}
          className={cn(known.className)}
          {...rest}
        >
          {known.children}
        </div>
      );
    },
  },
);
