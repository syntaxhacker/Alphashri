import { createMemo, Show } from "solid-js";
import {
  Group,
  Text,
  ActionIcon,
  Tooltip,
  Tree,
  useTree,
  getTreeExpandedState,
  Box,
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

export function TemplateTreeView(props: TemplateTreeViewProps) {
  const nodeMap = createMemo(() => {
    const map = new Map<string, StrategyConfig>();
    for (const t of props.templates) {
      map.set(`tpl-${t.internal_id}`, t);
    }
    for (const s of props.strategies) {
      map.set(`var-${s.internal_id}`, s);
    }
    return map;
  });

  const treeData = createMemo(() =>
    props.templates.map((t) => ({
      value: `tpl-${t.internal_id}`,
      label: t.name,
      children: props.strategies
        .filter(
          (s) => s.parent_id != null && String(s.parent_id) === String(t.internal_id ?? t.id),
        )
        .map((s) => ({
          value: `var-${s.internal_id}`,
          label: s.name,
        })),
    })),
  );

  const tree = useTree({
    initialExpandedState: getTreeExpandedState(treeData(), "*"),
  });

  const renderNode = ({ node, elementProps }: any) => {
    const config = nodeMap().get(node.value);
    if (!config) return <span {...elementProps}>{node.label}</span>;

    const isTemplate = node.value.startsWith("tpl-");
    const id = config.internal_id ?? Number(config.id);
    const vars = isTemplate
      ? props.strategies.filter((s) => s.parent_id != null && String(s.parent_id) === String(id))
      : [];

    const colStyle: JSX.CSSProperties = { width: "70px", "flex-shrink": 0 };

    return (
      <Group
        gap={1}
        wrap="nowrap"
        align="center"
        {...elementProps}
        style={{ ...(elementProps.style as JSX.CSSProperties), padding: "2px 0", display: "flex", "align-items": "center", gap: "8px" }}
      >
        <Text size="sm" fw={isTemplate ? 600 : 400} c={isTemplate ? undefined : "dimmed"} style={{ width: "180px", "flex-shrink": 0, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap", display: "flex", "align-items": "center" }}>
          {node.label as string}
        </Text>

        <Text size="xs" c="text.secondary" style={{ width: "90px", "flex-shrink": 0, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
          <span class="font-mono tabular-nums">{isTemplate ? config.strategy_type : ""}</span>
        </Text>

        <span style={colStyle}>
          <EditableNumberCell
            value={config.sl_pct}
            field="sl_pct"
            strategyId={id}
            step={0.1}
            decimalScale={1}
            min={0.1}
            suffix="%"
            onUpdate={props.onUpdate}
          />
        </span>
        <span style={colStyle}>
          <EditableNumberCell
            value={config.tp_pct}
            field="tp_pct"
            strategyId={id}
            step={0.1}
            decimalScale={1}
            min={0.1}
            suffix="%"
            onUpdate={props.onUpdate}
          />
        </span>
        <span style={{ ...colStyle, width: "60px" }}>
          <EditableNumberCell
            value={config.max_positions}
            field="max_positions"
            strategyId={id}
            step={1}
            decimalScale={0}
            min={1}
            max={20}
            onUpdate={props.onUpdate}
          />
        </span>

        <Group gap={2} style={{ "flex-shrink": 0, width: "90px" }} wrap="nowrap">
          <Show
            when={isTemplate}
            fallback={
              <>
                <Tooltip label="Edit strategy" withinPortal>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="primary"
                    onClick={() => props.onEditStrategy(config)}
                    data-testid={`edit-strategy-btn-${id}`}
                  >
                    <IconEdit size={13} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Delete strategy" withinPortal>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="error"
                    onClick={() => props.onDeleteStrategy(id)}
                    data-testid={`delete-strategy-btn-${id}`}
                  >
                    <IconTrash size={13} />
                  </ActionIcon>
                </Tooltip>
              </>
            }
          >
            <>
              <Tooltip label="Edit template params" withinPortal>
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="secondary"
                  onClick={() => props.onEditTemplate(config)}
                  data-testid={`edit-template-btn-${id}`}
                >
                  <IconEdit size={13} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Push params to all variations" withinPortal>
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="secondary"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Push "${config.name}" params to ${vars.length} variation(s)?`,
                      )
                    ) {
                      props.onSyncVariations(id);
                    }
                  }}
                  data-testid={`sync-variations-btn-${id}`}
                >
                  <IconRefresh size={13} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Create new variation" withinPortal>
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="info"
                  onClick={() => props.onCreateFromTemplate(config)}
                  data-testid={`create-variation-btn-${id}`}
                >
                  <IconPlus size={13} />
                </ActionIcon>
              </Tooltip>
            </>
          </Show>
        </Group>
      </Group>
    );
  };

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
          <Group
            gap={1}
            align="center"
            className="items-center"
            style={{ "padding-top": "8px", "padding-bottom": "4px", "padding-right": "8px", "padding-left": 0 }}
          >
            <span style={{ width: "18px", "flex-shrink": 0 }} />
            <Text size="xs" c="dimmed" style={{ width: "180px", display: "flex", "align-items": "center" }}>
              Name
            </Text>
            <Text size="xs" c="dimmed" style={{ width: "90px", display: "flex", "align-items": "center" }}>
              Type
            </Text>
            <Text size="xs" c="dimmed" style={{ width: "70px", display: "flex", "align-items": "center" }}>
              SL%
            </Text>
            <Text size="xs" c="dimmed" style={{ width: "70px", display: "flex", "align-items": "center" }}>
              TP%
            </Text>
            <Text size="xs" c="dimmed" style={{ width: "60px", display: "flex", "align-items": "center" }}>
              MaxPos
            </Text>
            <Text size="xs" c="dimmed" style={{ width: "90px", display: "flex", "align-items": "center" }}>
              Actions
            </Text>
          </Group>
          <Tree
            data={treeData()}
            tree={tree}
            levelOffset={20}
            expandOnClick={false}
            selectOnClick={false}
            renderNode={renderNode}
          />
        </Box>
      </Show>
    </Show>
  );
}
