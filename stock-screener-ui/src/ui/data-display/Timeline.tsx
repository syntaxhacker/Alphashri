import * as React from "react";
import { cn } from "../cn";
import type { UITimelineProps, UITimelineItemProps } from "../types";

type TimelineContextValue = {
  active?: number;
  bulletSize?: number | string;
  color?: string;
  lineWidth?: number;
  reverseActive?: boolean;
  align?: string;
  itemCount: number;
};

const TimelineContext = React.createContext<TimelineContextValue>({ itemCount: 0 });

function toneColor(c?: string): string {
  switch (c) {
    case "success": return "fin-positive";
    case "error":
    case "danger": return "fin-negative";
    case "warning": return "fin-warning";
    case "info": return "fin-info";
    case "secondary": return "fin-text-muted";
    default: return "fin-primary";
  }
}

export function Timeline({
  active,
  bulletSize,
  color,
  align,
  lineWidth,
  reverseActive,
  children,
  className,
  style,
  id,
  "data-testid": testId,
  ...rest
}: UITimelineProps) {
  const count = React.Children.count(children);
  const ctx: TimelineContextValue = { active, bulletSize, color, lineWidth, reverseActive, align, itemCount: count };

  const cls = cn(
    "ui-timeline",
    "relative flex flex-col",
    align === "right" ? "items-end" : "items-start",
    className,
  );

  return (
    <TimelineContext.Provider value={ctx}>
      <ol id={id} className={cls} style={style} data-testid={testId} {...(rest as any)}>
        {children}
      </ol>
    </TimelineContext.Provider>
  );
}

export function TimelineItem({
  title,
  bullet,
  color: itemColor,
  lineVariant,
  active: _itemActive,
  children,
  className,
  style,
  id,
  "data-testid": testId,
  ...rest
}: UITimelineItemProps) {
  const ctx = React.useContext(TimelineContext);
  const bs = ctx.bulletSize ?? 20;
  const lineW = ctx.lineWidth ?? 2;
  const tone = toneColor((itemColor as string) ?? (ctx.color as string));
  const isRight = ctx.align === "right";
  const borderStyle = lineVariant === "dashed" ? "dashed" : lineVariant === "dotted" ? "dotted" : "solid";
  const size = typeof bs === "number" ? `${bs}px` : String(bs ?? 16);

  const bulletCls = cn(
    "ui-timeline-bullet",
    "flex shrink-0 items-center justify-center rounded-full font-mono text-[10px]",
    bullet ? `bg-fin-surface border-2 border-${tone} text-${tone}` : `bg-${tone} text-white`,
    `w-[${size}] h-[${size}]`
  );

  const lineCls = cn(
    "ui-timeline-line",
    "shrink-0 mt-[4px]",
    lineVariant === "solid" || !lineVariant
      ? `w-[${lineW}px] bg-fin-border`
      : `w-[${lineW}px] border-l-[${lineW}px] border-l-${borderStyle} border-l-fin-border bg-transparent`
  );

  const itemCls = cn(
    "ui-timeline-item",
    "flex gap-3 relative min-h-[56px]",
    isRight ? "flex-row-reverse text-right" : "flex-row text-left",
    className,
  );

  return (
    <li id={id} className={itemCls} style={style} data-testid={testId} {...(rest as any)}>
      <div className="flex flex-col items-center" style={{ width: size }}>
        <div className={bulletCls}>{bullet}</div>
        <div className={lineCls} />
      </div>
      <div className="flex-1 flex flex-col">
        {title ? (
          <h3 className="ui-timeline-title font-semibold text-[14px] mb-[2px]">{title}</h3>
        ) : null}
        <div className="ui-timeline-body text-[13px] text-fin-text-muted">{children}</div>
      </div>
    </li>
  );
}

Timeline.Item = TimelineItem;
