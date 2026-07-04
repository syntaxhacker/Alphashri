import { Tree as MantineTree } from "@mantine/core";
import type { UITreeProps } from "../types";

export function Tree({ data, tree, expanded, onExpandedChange, onNodeClick, levelOffset, renderNode, className, style, "data-testid": testId }: UITreeProps) {
  if (renderNode) {
    return <MantineTree data={data as any} tree={tree} expanded={expanded} onExpandedChange={onExpandedChange} onNodeClick={(node: any) => onNodeClick?.(node)} levelOffset={levelOffset} renderNode={(payload: any) => renderNode({ node: payload.node, expanded: payload.expanded, hasChildren: payload.hasChildren, level: payload.level, elementProps: payload.elementProps })} className={className} style={style} data-testid={testId} />;
  }
  return <MantineTree data={data as any} tree={tree} expanded={expanded} onExpandedChange={onExpandedChange} onNodeClick={(node: any) => onNodeClick?.(node)} levelOffset={levelOffset} className={className} style={style} data-testid={testId} />;
}
