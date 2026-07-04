import { Skeleton as MantineSkeleton } from "@mantine/core";
import type { UISkeletonProps } from "../types";

export function Skeleton({ h, w, circle, radius, animate, visible, children, className, style, "data-testid": testId, ...rest }: UISkeletonProps) {
  return <MantineSkeleton h={h} w={w} circle={circle} radius={radius} animate={animate} visible={visible} className={className} style={style} data-testid={testId} {...rest}>{children}</MantineSkeleton>;
}
