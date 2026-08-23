import * as React from "react";
import Box from "@mui/material/Box";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import type { UITreeProps, UITreeNode } from "../types";

function TreeNode({
  node,
  level,
  levelOffset,
  expandedSet,
  onToggle,
  onNodeClick,
  renderNode,
}: {
  node: UITreeNode;
  level: number;
  levelOffset: number;
  expandedSet: Set<string>;
  onToggle: (value: string) => void;
  onNodeClick?: (node: UITreeNode) => void;
  renderNode?: UITreeProps["renderNode"];
}) {
  const hasChildren = !!(node.children && node.children.length > 0);
  const expanded = expandedSet.has(node.value);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasChildren) onToggle(node.value);
  };

  const handleClick = () => {
    onNodeClick?.(node);
    if (hasChildren) onToggle(node.value);
  };

  if (renderNode) {
    return (
      <>
        <Box
          onClick={handleClick}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            pl: `${level * levelOffset}px`,
            py: 0.5,
            cursor: "pointer",
            "&:hover": { bgcolor: "action.hover" },
            borderRadius: 0.5,
          }}
        >
          {hasChildren && (
            <IconButton size="small" onClick={handleToggle} sx={{ p: 0.25, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
              <ChevronRightIcon fontSize="small" />
            </IconButton>
          )}
          {!hasChildren && <Box sx={{ width: 24 }} />}
          <Box sx={{ flex: 1 }}>
            {renderNode({ node, expanded, hasChildren, level, elementProps: {} } as any)}
          </Box>
        </Box>
        {hasChildren && (
          <Collapse in={expanded} timeout="auto" unmountOnExit>
            <Box>
              {node.children!.map((child) => (
                <TreeNode
                  key={child.value}
                  node={child}
                  level={level + 1}
                  levelOffset={levelOffset}
                  expandedSet={expandedSet}
                  onToggle={onToggle}
                  onNodeClick={onNodeClick}
                  renderNode={renderNode}
                />
              ))}
            </Box>
          </Collapse>
        )}
      </>
    );
  }

  return (
    <>
      <Box
        onClick={handleClick}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          pl: `${level * levelOffset}px`,
          py: 0.5,
          cursor: "pointer",
          "&:hover": { bgcolor: "action.hover" },
          borderRadius: 0.5,
          fontSize: 14,
        }}
      >
        {hasChildren ? (
          <IconButton
            size="small"
            onClick={handleToggle}
            aria-label={expanded ? "collapse" : "expand"}
            sx={{ p: 0.25, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}
          >
            <ChevronRightIcon fontSize="small" />
          </IconButton>
        ) : (
          <Box sx={{ width: 24 }} />
        )}
        <Box sx={{ flex: 1 }}>{node.label}</Box>
      </Box>
      {hasChildren && (
        <Collapse in={expanded} timeout="auto" unmountOnExit>
          <Box>
            {node.children!.map((child) => (
              <TreeNode
                key={child.value}
                node={child}
                level={level + 1}
                levelOffset={levelOffset}
                expandedSet={expandedSet}
                onToggle={onToggle}
                onNodeClick={onNodeClick}
                renderNode={renderNode}
              />
            ))}
          </Box>
        </Collapse>
      )}
    </>
  );
}

export function Tree({ data, tree, expanded, onExpandedChange, onNodeClick, levelOffset = 16, renderNode, className, style, "data-testid": testId }: UITreeProps) {
  // Determine controlled vs uncontrolled
  const treeExpanded: string[] | undefined = tree?.expandedState ? Object.keys(tree.expandedState).filter((k) => (tree.expandedState as any)[k]) : tree?.expanded;
  const controlled = expanded ?? treeExpanded;
  const [internal, setInternal] = React.useState<string[]>(() => (controlled as string[]) ?? []);
  const isControlled = expanded !== undefined || treeExpanded !== undefined;

  // sync if controlled changes (derived)
  const expandedArray: string[] = (isControlled ? (controlled as string[]) : internal) ?? [];
  const expandedSet = React.useMemo(() => new Set(expandedArray), [expandedArray]);

  const handleToggle = React.useCallback(
    (value: string) => {
      const next = expandedSet.has(value) ? expandedArray.filter((v) => v !== value) : [...expandedArray, value];
      if (!isControlled) setInternal(next);
      onExpandedChange?.(next);
      // also sync to tree object if provided
      if (tree?.setExpanded) tree.setExpanded(next);
      if (tree?.toggleExpanded) {
        // fallback for custom tree shape
      }
    },
    [expandedSet, expandedArray, isControlled, onExpandedChange, tree]
  );

  // Support tree that uses toggleExpanded per node value (Mantive useTree)
  // If tree has methods, we already handle.

  return (
    <Box className={className} style={style} data-testid={testId} sx={{ fontSize: 14 }}>
      {data.map((node) => (
        <TreeNode
          key={node.value}
          node={node}
          level={0}
          levelOffset={levelOffset}
          expandedSet={expandedSet}
          onToggle={handleToggle}
          onNodeClick={onNodeClick}
          renderNode={renderNode}
        />
      ))}
    </Box>
  );
}
