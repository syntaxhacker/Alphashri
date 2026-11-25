import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  splitProps,
  useContext,
} from "solid-js";
import { cn } from "../cn";
import type { UITreeProps, UITreeNode } from "../types";

type TreeContextValue = {
  expandedSet: () => Set<string>;
  onToggle: (value: string) => void;
  onNodeClick?: (node: UITreeNode) => void;
  levelOffset: number;
  visibleNodes: () => UITreeNode[];
  parentOf: (value: string) => UITreeNode | undefined;
  isActive: (value: string) => boolean;
  setActive: (value: string) => void;
  focusValue: (value: string | undefined) => void;
  registerNode: (value: string, el: HTMLElement | null) => void;
  selectValue: (value: string) => void;
  selectedValue: () => string | undefined;
};

const TreeContext = createContext<TreeContextValue>();

function useTreeContext() {
  const ctx = useContext(TreeContext);
  if (!ctx) throw new Error("TreeNode must be used within Tree");
  return ctx;
}

/** Decorative only: the treeitem owns expansion semantics and keyboard handling. */
function Chevron(props: { expanded: () => boolean }) {
  return (
    <span
      className="inline-flex items-center justify-center p-0 w-[22px] h-[22px] shrink-0 text-fin-text-muted transition-transform duration-150"
      style={{ transform: props.expanded() ? "rotate(90deg)" : undefined }}
      aria-hidden="true"
    >
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 18l-6-6 6-6" />
      </svg>
    </span>
  );
}

type TreeNodeProps = {
  node: UITreeNode;
  level: number;
  renderNode?: UITreeProps["renderNode"];
};

function TreeNode(props: TreeNodeProps) {
  const ctx = useTreeContext();
  const value = props.node.value;
  onCleanup(() => ctx.registerNode(value, null));

  const hasChildren = () => !!(props.node.children && props.node.children.length > 0);
  const expanded = createMemo(() => ctx.expandedSet().has(value));
  const paddingLeft = () => props.level * ctx.levelOffset;

  const activate = () => {
    ctx.selectValue(value);
    ctx.onNodeClick?.(props.node);
    if (hasChildren()) ctx.onToggle(value);
  };

  const handleClick = (e: MouseEvent) => {
    // Children are nested inside their parent treeitem; without this a click on
    // a descendant would also toggle every ancestor on the way to the root.
    e.stopPropagation();
    ctx.setActive(value);
    activate();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const nodes = ctx.visibleNodes();
    const index = nodes.findIndex((n) => n.value === value);
    if (index < 0) return;

    let next: string | undefined;
    switch (e.key) {
      case "ArrowDown":
        next = nodes[Math.min(index + 1, nodes.length - 1)]?.value;
        break;
      case "ArrowUp":
        next = nodes[Math.max(index - 1, 0)]?.value;
        break;
      case "Home":
        next = nodes[0]?.value;
        break;
      case "End":
        next = nodes[nodes.length - 1]?.value;
        break;
      case "ArrowRight":
        if (!hasChildren()) return;
        if (!expanded()) {
          e.preventDefault();
          e.stopPropagation();
          ctx.onToggle(value);
          return;
        }
        next = props.node.children?.[0]?.value;
        break;
      case "ArrowLeft":
        if (hasChildren() && expanded()) {
          e.preventDefault();
          e.stopPropagation();
          ctx.onToggle(value);
          return;
        }
        next = ctx.parentOf(value)?.value;
        break;
      case "Enter":
      case " ":
      case "Spacebar":
        e.preventDefault();
        e.stopPropagation();
        activate();
        return;
      default:
        return;
    }

    e.preventDefault();
    e.stopPropagation();
    if (next) ctx.focusValue(next);
  };

  const nodeCls = () =>
    cn(
      "ui-tree-node",
      "flex items-center gap-2 cursor-pointer select-none rounded-[4px] py-[2px] text-ui-label text-fin-text hover:bg-fin-surface-alt focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fin-text",
    );

  return (
    <li
      role="treeitem"
      ref={(el) => ctx.registerNode(value, el)}
      tabIndex={ctx.isActive(value) ? 0 : -1}
      aria-expanded={hasChildren() ? expanded() : undefined}
      aria-selected={ctx.selectedValue() === value}
      aria-level={props.level + 1}
      className={nodeCls()}
      style={{ "padding-left": `${paddingLeft()}px` }}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onFocus={() => ctx.setActive(value)}
    >
      <span className="flex items-center gap-2 min-w-0">
        {hasChildren() && <Chevron expanded={expanded} />}
        {!hasChildren() && <span className="w-[22px] shrink-0" />}
        <span className="flex-1 min-w-0">
          {props.renderNode
            ? props.renderNode({
                node: props.node,
                expanded: expanded(),
                hasChildren: hasChildren(),
                level: props.level,
                elementProps: {},
              } as any)
            : props.node.label}
        </span>
      </span>
      <Show when={hasChildren() && expanded()}>
        <ul role="group" className="list-none p-0 m-0 pl-2">
          <For each={props.node.children}>
            {(child) => <TreeNode node={child} level={props.level + 1} renderNode={props.renderNode} />}
          </For>
        </ul>
      </Show>
    </li>
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

  const nodeEls = new Map<string, HTMLElement>();
  const [activeValue, setActiveValue] = createSignal<string | undefined>(known.data?.[0]?.value);
  const [selectedValue, setSelectedValue] = createSignal<string | undefined>();

  const visibleNodes = createMemo(() => {
    const out: UITreeNode[] = [];
    const walk = (nodes: UITreeNode[]) => {
      for (const node of nodes ?? []) {
        out.push(node);
        if (node.children?.length && expandedSet().has(node.value)) walk(node.children);
      }
    };
    walk(known.data ?? []);
    return out;
  });

  const parentMap = createMemo(() => {
    const map = new Map<string, UITreeNode | undefined>();
    const walk = (nodes: UITreeNode[], parent?: UITreeNode) => {
      for (const node of nodes ?? []) {
        map.set(node.value, parent);
        walk(node.children ?? [], node);
      }
    };
    walk(known.data ?? []);
    return map;
  });

  createEffect(() => {
    const current = activeValue();
    if (current && !visibleNodes().some((n) => n.value === current)) {
      setActiveValue(visibleNodes()[0]?.value);
    }
  });

  const registerNode = (value: string, el: HTMLElement | null) => {
    if (el) nodeEls.set(value, el);
    else nodeEls.delete(value);
  };

  const focusValue = (value: string | undefined) => {
    if (!value) return;
    setActiveValue(value);
    nodeEls.get(value)?.focus();
  };

  const ctx: TreeContextValue = {
    expandedSet,
    onToggle: handleToggle,
    onNodeClick: known.onNodeClick,
    levelOffset,
    visibleNodes,
    parentOf: (value) => parentMap().get(value),
    isActive: (value) => (activeValue() ?? visibleNodes()[0]?.value) === value,
    setActive: setActiveValue,
    focusValue,
    registerNode,
    selectValue: setSelectedValue,
    selectedValue,
  };

  const cls = cn("ui-tree", "list-none p-0 m-0 text-ui-label", known.className);

  return (
    <TreeContext.Provider value={ctx}>
      <ul
        id={known.id}
        className={cls}
        style={known.style as Record<string, string | undefined>}
        data-testid={known["data-testid"]}
        {...(rest as Record<string, unknown>)}
        role="tree"
      >
        <For each={known.data}>{(node) => <TreeNode node={node} level={0} renderNode={known.renderNode} />}</For>
      </ul>
    </TreeContext.Provider>
  );
}
