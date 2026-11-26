import { createMemo, For, Show } from "solid-js";
import {
  Group,
  Text,
  ActionIcon,
  Tooltip,
  Tree,
  useTree,
  getTreeExpandedState,
  Box,
  useMediaQuery,
} from "@/ui";
import {
  IconEdit,
  IconTrash,
  IconPlus,
  IconRefresh,
} from "../common/Icons";
import type { JSX } from "solid-js";
import type { StrategyConfig } from "../../types/strategies";
import type { TemplateTreeViewProps } from "./types";
import { EditableNumberCell } from "./EditableNumberCell";

export interface StrategyTreeIndex {
  nodeMap: Map<string, StrategyConfig>;
  variationsByParent: Map<string, StrategyConfig[]>;
}

const NARROW_QUERY = "(max-width: 899px)";

// The header and every row must consume the same track sizes; the old fixed
// inline widths were applied to one and not the other, which is why the
// 390px header arrived as "Name / MaxPos / Actions / Type / SL%" with TP%
// on a stray line. Numeric tracks are pinned so the values stay right-aligned.
const GRID_COLUMNS = "minmax(160px,240px) minmax(96px,140px) 80px 80px 72px 112px";
const GUTTER = 30; // 22px tree chevron + 8px flex gap, mirrored by the header.

function gridStyle(): JSX.CSSProperties {
  return {
    display: "grid",
    "grid-template-columns": GRID_COLUMNS,
    "column-gap": "8px",
    "align-items": "center",
    width: "100%",
    "min-width": "0px",
  };
}

const right = { display: "flex", "justify-content": "flex-end", "min-width": "0px" } as const;

// Single pass over templates and strategies. Per-template filtering would rescan
// every strategy for every template (O(T*S)) in both treeData and renderNode.
export function buildStrategyTreeIndex(
  templates: StrategyConfig[],
  strategies: StrategyConfig[],
): StrategyTreeIndex {
  const nodeMap = new Map<string, StrategyConfig>();
  for (const t of templates) {
    nodeMap.set(`tpl-${t.internal_id}`, t);
  }

  const variationsByParent = new Map<string, StrategyConfig[]>();
  for (const s of strategies) {
    nodeMap.set(`var-${s.internal_id}`, s);
    const parentId = s.parent_id;
    if (parentId != null) {
      const key = String(parentId);
      const group = variationsByParent.get(key);
      if (group) {
        group.push(s);
      } else {
        variationsByParent.set(key, [s]);
      }
    }
  }
  return { nodeMap, variationsByParent };
}

export function TemplateTreeView(props: TemplateTreeViewProps) {
  const index = createMemo(() => buildStrategyTreeIndex(props.templates, props.strategies));
  const isNarrow = useMediaQuery(NARROW_QUERY);

  const treeData = createMemo(() => {
    const { variationsByParent } = index();
    return props.templates.map((t) => ({
      value: `tpl-${t.internal_id}`,
      label: t.name,
      children: (variationsByParent.get(String(t.internal_id ?? t.id)) ?? []).map((s) => ({
        value: `var-${s.internal_id}`,
        label: s.name,
        level: 1,
      })),
    }));
  });

  const tree = useTree({
    initialExpandedState: getTreeExpandedState(treeData(), "*"),
  });

  const typeOf = (config: StrategyConfig, isTemplate: boolean): string => {
    if (config.strategy_type) return config.strategy_type;
    if (!isTemplate && config.parent_id != null) {
      return index().nodeMap.get(`tpl-${config.parent_id}`)?.strategy_type || "—";
    }
    return "—";
  };

  const renderActions = (
    config: StrategyConfig,
    isTemplate: boolean,
    id: number,
    variationCount: number,
  ) => (
    <Group gap={2} style={{ "flex-shrink": 0, ...right }} wrap="nowrap">
      <Show
        when={isTemplate}
        fallback={
          <>
            <Tooltip label="Edit strategy">
              <ActionIcon
                size="sm"
                variant="subtle"
                color="primary"
                onClick={() => props.onEditStrategy(config)}
                data-testid={`edit-strategy-btn-${id}`}
              >
                <IconEdit size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Delete strategy">
              <ActionIcon
                size="sm"
                variant="subtle"
                color="error"
                onClick={() => props.onDeleteStrategy(id)}
                data-testid={`delete-strategy-btn-${id}`}
              >
                <IconTrash size={14} />
              </ActionIcon>
            </Tooltip>
          </>
        }
      >
        <>
          <Tooltip label="Edit template params">
            <ActionIcon
              size="sm"
              variant="subtle"
              color="secondary"
              onClick={() => props.onEditTemplate(config)}
              data-testid={`edit-template-btn-${id}`}
            >
              <IconEdit size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Push params to all variations">
            <ActionIcon
              size="sm"
              variant="subtle"
              color="secondary"
              onClick={() => {
                if (
                  window.confirm(
                    `Push "${config.name}" params to ${variationCount} variation(s)?`,
                  )
                ) {
                  props.onSyncVariations(id);
                }
              }}
              data-testid={`sync-variations-btn-${id}`}
            >
              <IconRefresh size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Create new variation">
            <ActionIcon
              size="sm"
              variant="subtle"
              color="info"
              onClick={() => props.onCreateFromTemplate(config)}
              data-testid={`create-variation-btn-${id}`}
            >
              <IconPlus size={14} />
            </ActionIcon>
          </Tooltip>
        </>
      </Show>
    </Group>
  );

  const numberCell = (
    config: StrategyConfig,
    id: number,
    field: "sl_pct" | "tp_pct" | "max_positions",
  ) => {
    const isCount = field === "max_positions";
    return (
      <span style={right}>
        <EditableNumberCell
          value={config[field]}
          field={field}
          strategyId={id}
          step={isCount ? 1 : 0.1}
          decimalScale={isCount ? 0 : 1}
          min={isCount ? 1 : 0.1}
          max={isCount ? 20 : undefined}
          suffix={isCount ? undefined : "%"}
          onUpdate={props.onUpdate}
        />
      </span>
    );
  };

  const renderNode = ({ node, elementProps }: any) => {
    const { nodeMap, variationsByParent } = index();
    const config = nodeMap.get(node.value);
    if (!config) return <span {...elementProps}>{node.label}</span>;

    const isTemplate = node.value.startsWith("tpl-");
    const id = config.internal_id ?? Number(config.id);
    const variationCount = isTemplate
      ? (variationsByParent.get(String(id)) ?? []).length
      : 0;

    return (
      <div {...elementProps} data-testid={`strategy-row-${id}`} style={gridStyle()}>
        <Text
          size="sm"
          fw={isTemplate ? 600 : 400}
          c={isTemplate ? undefined : "dimmed"}
          style={{
            "min-width": "0px",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
            "padding-left": `${isTemplate ? 0 : 12}px`,
          }}
        >
          {node.label as string}
        </Text>
        <Text
          size="xs"
          c="text.secondary"
          style={{
            "min-width": "0px",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}
        >
          <span class="font-mono tabular-nums">{typeOf(config, isTemplate)}</span>
        </Text>
        {numberCell(config, id, "sl_pct")}
        {numberCell(config, id, "tp_pct")}
        {numberCell(config, id, "max_positions")}
        {renderActions(config, isTemplate, id, variationCount)}
      </div>
    );
  };

  const narrowCard = (config: StrategyConfig, isTemplate: boolean) => {
    const id = config.internal_id ?? Number(config.id);
    const variationCount = isTemplate
      ? (index().variationsByParent.get(String(id)) ?? []).length
      : 0;
    return (
      <div
        data-testid={`strategy-tree-card-${id}`}
        class="flex flex-col gap-2 rounded-fin border border-fin-border bg-fin-surface p-2"
      >
        <div class="flex items-start justify-between gap-2">
          <Text size="sm" fw={600} className="min-w-0 break-words">{config.name}</Text>
          <Text size="xs" c="text.secondary" className="shrink-0 font-mono tabular-nums">
            {typeOf(config, isTemplate)}
          </Text>
        </div>
        <div class="grid grid-cols-3 gap-2">
          <div class="flex min-w-0 flex-col gap-1">
            <Text size="xs" c="dimmed">SL%</Text>
            {numberCell(config, id, "sl_pct")}
          </div>
          <div class="flex min-w-0 flex-col gap-1">
            <Text size="xs" c="dimmed">TP%</Text>
            {numberCell(config, id, "tp_pct")}
          </div>
          <div class="flex min-w-0 flex-col gap-1">
            <Text size="xs" c="dimmed">MaxPos</Text>
            {numberCell(config, id, "max_positions")}
          </div>
        </div>
        <div style={right}>{renderActions(config, isTemplate, id, variationCount)}</div>
      </div>
    );
  };

  const narrowList = () => (
    <div data-testid="strategy-tree-narrow" class="flex min-h-0 flex-col gap-2">
      <For each={props.templates}>
        {(template) => (
          <>
            {narrowCard(template, true)}
            <For
              each={
                index().variationsByParent.get(
                  String(template.internal_id ?? template.id),
                ) ?? []
              }
            >
              {(variation) => narrowCard(variation, false)}
            </For>
          </>
        )}
      </For>
    </div>
  );

  return (
    <Show
      when={!(props.isLoading && props.templates.length === 0)}
      fallback={
        <Box data-testid="template-tree-loading" className="p-2">
          <Text size="sm" fw={600}>Loading…</Text>
          <Text size="xs" c="dimmed">Fetching strategy templates</Text>
        </Box>
      }
    >
      <Show
        when={props.templates.length > 0}
        fallback={
          <Box data-testid="template-tree-empty" className="p-2">
            <Text size="sm" fw={600}>No templates</Text>
            <Text size="xs" c="dimmed">Run the seed script to create strategy templates</Text>
          </Box>
        }
      >
        <Box className="template-tree-view min-h-0" data-testid="template-tree-panel">
          <Show when={isNarrow()} fallback={
            <>
              <div
                data-testid="strategy-tree-header"
                class="text-ui-micro text-fin-text-muted"
                style={{ ...gridStyle(), "padding-left": `${GUTTER}px` }}
              >
                <Text size="xs" c="dimmed" style={{ "white-space": "nowrap" }}>Name</Text>
                <Text size="xs" c="dimmed" style={{ "white-space": "nowrap" }}>Type</Text>
                <Text size="xs" c="dimmed" style={{ ...right, "white-space": "nowrap" }}>SL%</Text>
                <Text size="xs" c="dimmed" style={{ ...right, "white-space": "nowrap" }}>TP%</Text>
                <Text size="xs" c="dimmed" style={{ ...right, "white-space": "nowrap" }}>MaxPos</Text>
                <Text size="xs" c="dimmed" style={{ ...right, "white-space": "nowrap" }}>Actions</Text>
              </div>
              <Tree
                data={treeData()}
                tree={tree}
                levelOffset={0}
                className="[&_ul]:!pl-0 [&_li>span:first-child]:!flex-1"
                renderNode={renderNode}
              />
            </>
          }>
            {narrowList()}
          </Show>
        </Box>
      </Show>
    </Show>
  );
}
