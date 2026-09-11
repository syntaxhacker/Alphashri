import { useMemo, useCallback } from "react";
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
} from "@tabler/icons-react";
import type { StrategyConfig } from "../../types/strategies";
import type { TemplateTreeViewProps } from "./types";
import { EditableNumberCell } from "./EditableNumberCell";

export function TemplateTreeView({
  templates,
  strategies,
  onEditTemplate,
  onSyncVariations,
  onCreateFromTemplate,
  onEditStrategy,
  onDeleteStrategy,
  onUpdate,
  isLoading,
}: TemplateTreeViewProps) {
  const nodeMap = useMemo(() => {
    const map = new Map<string, StrategyConfig>();
    for (const t of templates) {
      map.set(`tpl-${t.internal_id}`, t);
    }
    for (const s of strategies) {
      map.set(`var-${s.internal_id}`, s);
    }
    return map;
  }, [templates, strategies]);

  const treeData = useMemo(
    () =>
      templates.map((t) => ({
        value: `tpl-${t.internal_id}`,
        label: t.name,
        children: strategies
          .filter(
            (s) => s.parent_id != null && String(s.parent_id) === String(t.internal_id ?? t.id),
          )
          .map((s) => ({
            value: `var-${s.internal_id}`,
            label: s.name,
          })),
      })),
    [templates, strategies],
  );

  const tree = useTree({
    initialExpandedState: getTreeExpandedState(treeData, "*"),
  });

  const renderNode = useCallback(
    ({ node, elementProps }: any) => {
      const config = nodeMap.get(node.value);
      if (!config) return <span {...elementProps}>{node.label}</span>;

      const isTemplate = node.value.startsWith("tpl-");
      const id = config.internal_id ?? Number(config.id);
      const vars = isTemplate
        ? strategies.filter((s) => s.parent_id != null && String(s.parent_id) === String(id))
        : [];

      const colStyle: React.CSSProperties = { width: 70, flexShrink: 0 };

      return (
        <Group
          gap={1}
          wrap="nowrap"
          align="center"
          {...elementProps}
          style={{ ...(elementProps.style as React.CSSProperties), padding: "2px 0", display: "flex", alignItems: "center", gap: 8 }}
        >
          <Text size="sm" fw={isTemplate ? 600 : 400} c={isTemplate ? undefined : "dimmed"} style={{ width: 180, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center" }}>
            {node.label as string}
          </Text>

          <Text size="xs" c="text.secondary" style={{ width: 90, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {isTemplate ? config.strategy_type : ""}
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
              onUpdate={onUpdate}
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
              onUpdate={onUpdate}
            />
          </span>
          <span style={{ ...colStyle, width: 60 }}>
            <EditableNumberCell
              value={config.max_positions}
              field="max_positions"
              strategyId={id}
              step={1}
              decimalScale={0}
              min={1}
              max={20}
              onUpdate={onUpdate}
            />
          </span>

          <Group gap={2} style={{ flexShrink: 0, width: 90 }} wrap="nowrap">
            {isTemplate ? (
              <>
                <Tooltip label="Edit template params" withinPortal>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="secondary"
                    onClick={() => onEditTemplate(config)}
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
                        onSyncVariations(id);
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
                    onClick={() => onCreateFromTemplate(config)}
                    data-testid={`create-variation-btn-${id}`}
                  >
                    <IconPlus size={13} />
                  </ActionIcon>
                </Tooltip>
              </>
            ) : (
              <>
                <Tooltip label="Edit strategy" withinPortal>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="primary"
                    onClick={() => onEditStrategy(config)}
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
                    onClick={() => onDeleteStrategy(id)}
                    data-testid={`delete-strategy-btn-${id}`}
                  >
                    <IconTrash size={13} />
                  </ActionIcon>
                </Tooltip>
              </>
            )}
          </Group>
        </Group>
      );
    },
    [
      nodeMap,
      strategies,
      onEditTemplate,
      onSyncVariations,
      onCreateFromTemplate,
      onEditStrategy,
      onDeleteStrategy,
      onUpdate,
      tree,
    ],
  );

  if (isLoading && templates.length === 0) {
    return (
      <Box data-testid="template-tree-loading" sx={{ p: 1 }}>
        <Text size="sm" fw={600}>Loading…</Text>
        <Text size="xs" c="dimmed">Fetching strategy templates</Text>
      </Box>
    );
  }
  if (templates.length === 0) {
    return (
      <Box data-testid="template-tree-empty" sx={{ p: 1 }}>
        <Text size="sm" fw={600}>No templates</Text>
        <Text size="xs" c="dimmed">Run the seed script to create strategy templates</Text>
      </Box>
    );
  }

  return (
    <Box className="template-tree-view" data-testid="template-tree-panel" sx={{ minHeight: 0 }}>
      <Group
        gap={1}
        align="center"
        sx={{ display: "flex", alignItems: "center", gap: 1, pt: 1, pb: 0.5, pr: 1, pl: 0 }}
      >
        <span style={{ width: 18, flexShrink: 0 }} />
        <Text size="xs" c="dimmed" style={{ width: 180, display: "flex", alignItems: "center" }}>
          Name
        </Text>
        <Text size="xs" c="dimmed" style={{ width: 90, display: "flex", alignItems: "center" }}>
          Type
        </Text>
        <Text size="xs" c="dimmed" style={{ width: 70, display: "flex", alignItems: "center" }}>
          SL%
        </Text>
        <Text size="xs" c="dimmed" style={{ width: 70, display: "flex", alignItems: "center" }}>
          TP%
        </Text>
        <Text size="xs" c="dimmed" style={{ width: 60, display: "flex", alignItems: "center" }}>
          MaxPos
        </Text>
        <Text size="xs" c="dimmed" style={{ width: 90, display: "flex", alignItems: "center" }}>
          Actions
        </Text>
      </Group>
      <Tree
        data={treeData}
        tree={tree}
        levelOffset={20}
        expandOnClick={false}
        selectOnClick={false}
        renderNode={renderNode}
      />
    </Box>
  );
}
