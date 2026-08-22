import { Timeline as MantineTimeline } from "@mantine/core";
import type { UITimelineProps, UITimelineItemProps } from "../types";

export function Timeline({ active, bulletSize, color, align, lineWidth, reverseActive, children, className, style, "data-testid": testId, ...rest }: UITimelineProps) {
  return <MantineTimeline active={active} bulletSize={bulletSize} color={color} align={align} lineWidth={lineWidth} reverseActive={reverseActive} className={className} style={style} data-testid={testId} {...rest}>{children}</MantineTimeline>;
}

export function TimelineItem({ title, bullet, color, lineVariant, active, children, className, style, "data-testid": testId, ...rest }: UITimelineItemProps) {
  return <MantineTimeline.Item title={title} bullet={bullet} color={color} lineVariant={lineVariant} active={active} {...({ className, style, "data-testid": testId, ...rest } as any)}>{children}</MantineTimeline.Item>;
}
Timeline.Item = TimelineItem;
