import { useMemo, useCallback } from "react";
import {
  Group,
  Text,
  Badge,
  ActionIcon,
  Tooltip,
  Tree,
  useTree,
  getTreeExpandedState,
} from "@/ui";
import {
  IconChevronDown,
  IconEdit,
  IconTrash,
  IconPlus,
  IconRefresh,
} from "@tabler/icons-react";
import type { StrategyConfig } from "../../types/strategies";
import type { TemplateTreeViewProps } from "./types";
import { CompactPanel } from "../common/compact";
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
    ({ node, expanded, hasChildren, elementProps }: any) => {
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
          {hasChildren ? (
            <IconChevronDown
              size={14}
              style={{
                cursor: "pointer",
                transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
                transition: "transform 150ms",
                flexShrink: 0,
              }}
              onClick={(e) => {
                e.stopPropagation();
                tree.toggleExpanded(node.value);
              }}
            />
          ) : (
            <span style={{ width: 14, flexShrink: 0 }} />
          )}

          <Text size="sm" fw={isTemplate ? 600 : 400} c={isTemplate ? undefined : "dimmed"} style={{ minWidth: 80, flexShrink: 0, display: "flex", alignItems: "center" }}>
            {node.label as string}
          </Text>

          {isTemplate && (
            <Badge size="sm" variant="light" style={{ width: 90, flexShrink: 0 }}>
              {config.strategy_type}
            </Badge>
          )}
          {!isTemplate && <span style={{ width: 90, flexShrink: 0 }} />}

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
      <CompactPanel
        title="Loading..."
        description="Fetching strategy templates"
        testId="template-tree-loading"
      />
    );
  }
  if (templates.length === 0) {
    return (
      <CompactPanel
        title="No Templates"
        description="Run seed script to create strategy templates"
        testId="template-tree-empty"
      />
    );
  }

  return (
    <CompactPanel
      title="Strategy Tree"
      description="Templates and their variations"
      testId="template-tree-panel"
      scrollable
    >
      <Group
        gap={1}
        align="center"
        px="sm"
        pb={4}
        sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}
      >
        <span style={{ width: 14, flexShrink: 0 }} />
        <Text size="xs" c="dimmed" style={{ minWidth: 80, display: "flex", alignItems: "center" }}>
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
    </CompactPanel>
  );
}
