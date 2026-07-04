import { Avatar as MantineAvatar } from "@mantine/core";
import type { UIAvatarProps } from "../types";

export function Avatar({ src, alt, color, radius, size, children, className, style, "data-testid": testId, ...rest }: UIAvatarProps) {
  return <MantineAvatar src={src} alt={alt} color={color} radius={radius} size={size} className={className} style={style} data-testid={testId} {...rest}>{children}</MantineAvatar>;
}
