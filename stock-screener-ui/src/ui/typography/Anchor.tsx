import { Anchor as MantineAnchor } from "@mantine/core";
import type { UIAnchorProps } from "../types";

export function Anchor({ children, href, target, underline, onClick, onMouseEnter, onMouseLeave, size, fw, c, ta, lh, span, truncate, lineClamp, inherit, component, className, style, "data-testid": testId }: UIAnchorProps) {
  return <MantineAnchor href={href} target={target} underline={underline} onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} size={size} fw={fw} c={c} ta={ta} lh={lh} span={span} truncate={truncate} lineClamp={lineClamp} inherit={inherit} component={component} className={className} style={style} data-testid={testId}>{children}</MantineAnchor>;
}
