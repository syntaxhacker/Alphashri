import { Tree as MantineTree } from "@mantine/core";
import type { UITreeProps } from "../types";

export function Tree({ data, tree, expanded, onExpandedChange, onNodeClick, levelOffset, renderNode, className, style, "data-testid": testId }: UITreeProps) {
  const base = { data: data as any, tree, expanded, onExpandedChange, onNodeClick: (node: any) => onNodeClick?.(node), levelOffset, className, style, "data-testid": testId } as any;
  if (renderNode) {
    return <MantineTree {...base} renderNode={(payload: any) => renderNode({ node: payload.node, expanded: payload.expanded, hasChildren: payload.hasChildren, level: payload.level, elementProps: payload.elementProps })} />;
  }
  return <MantineTree {...base} />;
}
