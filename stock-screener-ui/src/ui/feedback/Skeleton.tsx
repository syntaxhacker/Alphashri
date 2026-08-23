import MuiSkeleton from "@mui/material/Skeleton";
import type { UISkeletonProps } from "../types";

export function Skeleton({
  h,
  w,
  circle,
  radius,
  animate = true,
  visible = true,
  children,
  className,
  style,
  "data-testid": testId,
  id,
  ...rest
}: UISkeletonProps) {
  if (!visible) {
    return <>{children}</>;
  }

  const sx: Record<string, unknown> = {
    ...(h != null && { height: typeof h === "number" ? `${h}px` : h }),
    ...(w != null && { width: typeof w === "number" ? `${w}px` : w }),
    ...(radius != null
      ? {
          borderRadius:
            typeof radius === "number"
              ? `${radius}px`
              : radius === "xs"
                ? "4px"
                : radius === "xl"
                  ? "16px"
                  : undefined,
        }
      : {}),
  };

  // If children provided and skeleton visible, overlay skeleton over children area
  const hasChildren = children != null;

  return (
    <MuiSkeleton
      variant={circle ? "circular" : "rounded"}
      animation={animate === false ? false : "pulse"}
      className={className}
      style={style}
      id={id}
      data-testid={testId}
      sx={sx}
      {...(rest as Record<string, unknown>)}
    >
      {hasChildren ? children : undefined}
    </MuiSkeleton>
  );
}
