import * as React from "react";
import { cn } from "../cn";
import type { UITreeProps, UITreeNode } from "../types";

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <button
      type="button"
      className="p-0 w-[22px] h-[22px] shrink-0 text-fin-text-muted transition-transform duration-150 border-none bg-transparent outline-none"
      style={{ transform: expanded ? "rotate(90deg)" : undefined }}
      aria-hidden="true"
    >
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}

type TreeNodeProps = {
  node: UITreeNode;
  level: number;
  levelOffset: number;
  expandedSet: Set<string>;
  onToggle: (value: string) => void;
  onNodeClick?: (node: UITreeNode) => void;
  renderNode?: UITreeProps["renderNode"];
};

function TreeNode({ node, level, levelOffset, expandedSet, onToggle, onNodeClick, renderNode }: TreeNodeProps) {
  const hasChildren = !!(node.children && node.children.length > 0);
  const expanded = expandedSet.has(node.value);
  const paddingLeft = level * levelOffset;

  const handleClick = () => {
    onNodeClick?.(node);
    if (hasChildren) onToggle(node.value);
  };

  const nodeCls = cn(
    "ui-tree-node",
    "flex items-center gap-2 cursor-pointer select-none rounded-[4px] py-[2px] text-[14px] text-fin-text hover:bg-fin-surface-alt",
    `pl-[${paddingLeft}px]`
  );

  const renderPayload = { node, expanded, hasChildren, level, elementProps: {} } as any;

  if (renderNode) {
    return (
      <>
        <div onClick={handleClick} className={nodeCls} style={{ paddingLeft }}>
          {hasChildren && <Chevron expanded={expanded} />}
          {!hasChildren && <span className="w-[22px] shrink-0" />}
          <span className="flex-1 min-w-0">{renderNode(renderPayload)}</span>
        </div>
        {hasChildren && expanded && (
          <ul className="list-none p-0 m-0 pl-2">
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
          </ul>
        )}
      </>
    );
  }

  return (
    <>
      <div onClick={handleClick} className={nodeCls} style={{ paddingLeft }}>
        {hasChildren && <Chevron expanded={expanded} />}
        {!hasChildren && <span className="w-[22px] shrink-0" />}
        <span className="flex-1 min-w-0">{node.label}</span>
      </div>
      {hasChildren && expanded && (
        <ul className="list-none p-0 m-0 pl-2">
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
        </ul>
      )}
    </>
  );
}

export function Tree({
  data,
  tree,
  expanded,
  onExpandedChange,
  onNodeClick,
  levelOffset = 16,
  renderNode,
  className,
  style,
  id,
  "data-testid": testId,
  ...rest
}: UITreeProps) {
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
    },
    [expandedSet, expandedArray, isControlled, onExpandedChange, tree]
  );

  const cls = cn("ui-tree", "list-none p-0 m-0 text-[14px]", className);

  return (
    <ul id={id} className={cls} style={style} data-testid={testId} {...(rest as any)}>
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
    </ul>
  );
}
