import { createContext, createMemo, Show, splitProps, useContext } from "solid-js";
import { cn } from "../cn";
import type { UITimelineProps, UITimelineItemProps } from "../types";

type TimelineContextValue = {
  active?: () => number | undefined;
  bulletSize?: () => number | string | undefined;
  color?: () => string | undefined;
  lineWidth?: () => number | undefined;
  reverseActive?: () => boolean | undefined;
  align?: () => string | undefined;
  itemCount: () => number;
};

const TimelineContext = createContext<TimelineContextValue>({ itemCount: () => 0 });

function useTimelineContext() {
  return useContext(TimelineContext);
}

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

export function Timeline(props: UITimelineProps) {
  const [known, rest] = splitProps(props, [
    "active",
    "bulletSize",
    "color",
    "align",
    "lineWidth",
    "reverseActive",
    "children",
    "className",
    "style",
    "id",
    "data-testid",
  ]);

  const itemCount = createMemo(() => {
    const c = known.children();
    return Array.isArray(c) ? c.length : c ? 1 : 0;
  });

  const ctx: TimelineContextValue = {
    active: known.active,
    bulletSize: known.bulletSize,
    color: known.color,
    lineWidth: known.lineWidth,
    reverseActive: known.reverseActive,
    align: known.align,
    itemCount,
  };

  const cls = cn(
    "ui-timeline",
    "relative flex flex-col",
    known.align() === "right" ? "items-end" : "items-start",
    known.className(),
  );

  return (
    <TimelineContext.Provider value={ctx}>
      <ol
        id={known.id()}
        className={cls}
        style={known.style() as Record<string, string | undefined>}
        data-testid={known["data-testid"]()}
        {...(rest as Record<string, unknown>)}
      >
        {known.children()}
      </ol>
    </TimelineContext.Provider>
  );
}

export function TimelineItem(props: UITimelineItemProps) {
  const [known, rest] = splitProps(props, [
    "title",
    "bullet",
    "color",
    "lineVariant",
    "active",
    "children",
    "className",
    "style",
    "id",
    "data-testid",
  ]);
  const ctx = useTimelineContext();

  const bs = createMemo(() => ctx.bulletSize() ?? 20);
  const lineW = createMemo(() => ctx.lineWidth() ?? 2);
  const tone = createMemo(() => toneColor((known.color() as string) ?? (ctx.color() as string)));
  const isRight = createMemo(() => ctx.align() === "right");
  const size = createMemo(() => (typeof bs() === "number" ? `${bs()}px` : String(bs() ?? 16)));
  const borderStyle = createMemo(() => {
    const lv = known.lineVariant();
    return lv === "dashed" ? "dashed" : lv === "dotted" ? "dotted" : "solid";
  });

  const bulletCls = createMemo(() =>
    cn(
      "ui-timeline-bullet",
      "flex shrink-0 items-center justify-center rounded-full font-mono text-[10px]",
      known.bullet() ? `bg-fin-surface border-2 border-${tone()} text-${tone()}` : `bg-${tone()} text-white`,
      `w-[${size()}] h-[${size()}]`,
    ),
  );
  const lineCls = createMemo(() =>
    cn(
      "ui-timeline-line",
      "shrink-0 mt-[4px]",
      borderStyle() === "solid" || !known.lineVariant()
        ? `w-[${lineW()}px] bg-fin-border`
        : `w-[${lineW()}px] border-l-[${lineW()}px] border-l-${borderStyle()} border-l-fin-border bg-transparent`,
    ),
  );
  const itemCls = createMemo(() =>
    cn(
      "ui-timeline-item",
      "flex gap-3 relative min-h-[56px]",
      isRight() ? "flex-row-reverse text-right" : "flex-row text-left",
      known.className(),
    ),
  );

  return (
    <li
      id={known.id()}
      className={itemCls()}
      style={known.style() as Record<string, string | undefined>}
      data-testid={known["data-testid"]()}
      {...(rest as Record<string, unknown>)}
    >
      <div className="flex flex-col items-center" style={{ width: size() }}>
        <div className={bulletCls()}>{known.bullet()}</div>
        <div className={lineCls()} />
      </div>
      <div className="flex-1 flex flex-col">
        <Show when={known.title()}>
          <h3 className="ui-timeline-title font-semibold text-[14px] mb-[2px]">{known.title()}</h3>
        </Show>
        <div className="ui-timeline-body text-[13px] text-fin-text-muted">{known.children()}</div>
      </div>
    </li>
  );
}

Timeline.Item = TimelineItem;
