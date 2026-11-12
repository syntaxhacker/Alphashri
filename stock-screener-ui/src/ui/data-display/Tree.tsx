import { createMemo, createSignal, For, Show, splitProps } from "solid-js";
import { cn } from "../cn";
import type { UITreeProps, UITreeNode } from "../types";

function Chevron({ expanded }: { expanded: () => boolean }) {
  return (
    <button
      type="button"
      className="p-0 w-[22px] h-[22px] shrink-0 text-fin-text-muted transition-transform duration-150 border-none bg-transparent outline-none"
      style={{ transform: expanded() ? "rotate(90deg)" : undefined }}
      aria-hidden="true"
    >
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" stroke-width="2" d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}

type TreeNodeProps = {
  node: UITreeNode;
  level: number;
  levelOffset: number;
  expandedSet: () => Set<string>;
  onToggle: (value: string) => void;
  onNodeClick?: (node: UITreeNode) => void;
  renderNode?: UITreeProps["renderNode"];
};

function TreeNode({ node, level, levelOffset, expandedSet, onToggle, onNodeClick, renderNode }: TreeNodeProps) {
  const hasChildren = !!(node.children && node.children.length > 0);
  const expanded = createMemo(() => expandedSet().has(node.value));
  const paddingLeft = level * levelOffset;

  const handleClick = () => {
    onNodeClick?.(node);
    if (hasChildren) onToggle(node.value);
  };

  const nodeCls = cn(
    "ui-tree-node",
    "flex items-center gap-2 cursor-pointer select-none rounded-[4px] py-[2px] text-[14px] text-fin-text hover:bg-fin-surface-alt",
    `pl-[${paddingLeft}px]`,
  );

  const renderPayload = { node, expanded: expanded(), hasChildren, level, elementProps: {} } as any;

  const childrenList = () => (
    <ul className="list-none p-0 m-0 pl-2">
      <For each={node.children} key={(child) => child.value}>
        {(child) => (
          <TreeNode
            node={child}
            level={level + 1}
            levelOffset={levelOffset}
            expandedSet={expandedSet}
            onToggle={onToggle}
            onNodeClick={onNodeClick}
            renderNode={renderNode}
          />
        )}
      </For>
    </ul>
  );

  if (renderNode) {
    return (
      <>
        <div onClick={handleClick} className={nodeCls} style={{ paddingLeft }}>
          {hasChildren && <Chevron expanded={expanded} />}
          {!hasChildren && <span className="w-[22px] shrink-0" />}
          <span className="flex-1 min-w-0">{renderNode(renderPayload)}</span>
        </div>
        <Show when={hasChildren && expanded()}>{childrenList()}</Show>
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
      <Show when={hasChildren && expanded()}>{childrenList()}</Show>
    </>
  );
}

export function Tree(props: UITreeProps) {
  const [known, rest] = splitProps(props, [
    "data",
    "tree",
    "expanded",
    "onExpandedChange",
    "onNodeClick",
    "levelOffset",
    "renderNode",
    "className",
    "style",
    "id",
    "data-testid",
  ]);

  const levelOffset = known.levelOffset ?? 16;

  const treeExpanded = createMemo(() => {
    const t = known.tree;
    if (!t) return undefined;
    if (t.expandedState) return Object.keys(t.expandedState).filter((k) => (t.expandedState as any)[k]);
    return typeof t.expanded === "function" ? (t.expanded as () => string[])() : t.expanded;
  });

  const isControlled = createMemo(() => known.expanded !== undefined || treeExpanded() !== undefined);
  const controlled = createMemo(() => known.expanded ?? treeExpanded());

  const [internalValue, setInternal] = createSignal<string[]>(controlled() ?? []);
  const expandedArray = createMemo(() => (isControlled() ? (controlled() as string[]) : internalValue()));
  const expandedSet = createMemo(() => new Set(expandedArray()));

  const handleToggle = (value: string) => {
    const next = expandedSet().has(value) ? expandedArray().filter((v) => v !== value) : [...expandedArray(), value];
    if (!isControlled()) setInternal(next);
    known.onExpandedChange?.(next);
    known.tree?.setExpanded?.(next);
  };

  const cls = cn("ui-tree", "list-none p-0 m-0 text-[14px]", known.className);

  return (
    <ul
      id={known.id}
      className={cls}
      style={known.style as Record<string, string | undefined>}
      data-testid={known["data-testid"]}
      {...(rest as Record<string, unknown>)}
    >
      <For each={known.data} key={(node) => node.value}>
        {(node) => (
          <TreeNode
            node={node}
            level={0}
            levelOffset={levelOffset}
            expandedSet={expandedSet}
            onToggle={handleToggle}
            onNodeClick={known.onNodeClick}
            renderNode={known.renderNode}
          />
        )}
      </For>
    </ul>
  );
}
