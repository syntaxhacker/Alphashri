import { Show, Switch, Match } from "solid-js";
import { Box, Stack, Button, Group, Text } from "@/ui";
import { IconAlertCircle, IconRefresh } from "../common/Icons";
import { StrategiesNav } from "./StrategiesNav";
import { TemplateTreeView } from "./TemplateTreeView";
import { PerformanceView } from "./PerformanceView";
import { StrategyForm } from "./StrategyForm";
import type { StrategiesPageProps } from "./types";
import { CompactPanel } from "../common/compact";

export function StrategiesPage(props: StrategiesPageProps) {
  return (
    <Box className="strategies-page w-full h-full min-h-0 flex flex-col p-0 overflow-hidden px-4 py-2" data-testid="strategies-view" id="strategies-main">
      <Box className="flex-1 min-h-0 flex flex-col" data-testid="strategies-content" id="strategies-content">
        <StrategiesNav activeView={props.activeView} onChange={props.onViewChange}>
          <Show
            when={props.error}
            fallback={
              <Switch fallback={null}>
                <Match when={props.activeView === "tree"}>
                  <TemplateTreeView
                    templates={props.templates}
                    strategies={props.strategies}
                    onEditTemplate={props.onEditTemplate!}
                    onSyncVariations={props.onSyncVariations!}
                    onCreateFromTemplate={props.onCreateFromTemplate}
                    onEditStrategy={props.onOpenEditModal}
                    onDeleteStrategy={props.onDeleteStrategy}
                    onUpdate={props.onUpdate}
                    isLoading={props.isLoading}
                  />
                </Match>
                <Match when={props.activeView === "performance"}>
                  <PerformanceView
                    performance={props.performance}
                    strategies={props.strategies}
                    onSelectStrategy={props.onSelectStrategy}
                    isLoading={props.isLoading}
                  />
                </Match>
              </Switch>
            }
          >
            <Stack spacing={1} mt="sm">
              <CompactPanel
                testId="strategies-error"
                title={
                  <Group gap="xs" wrap="nowrap" align="center">
                    <IconAlertCircle size={18} />
                    <Text fw={600} size="sm">
                      Strategies failed to load
                    </Text>
                  </Group>
                }
                description={props.error ?? ""}
                action={
                  <Group gap="xs" align="center">
                    <Button
                      onClick={props.onRefresh}
                      variant="filled"
                      color="error"
                      size="sm"
                      leftSection={<IconRefresh size={14} />}
                      data-testid="strategies-retry-btn"
                    >
                      Retry
                    </Button>
                    <Button
                      onClick={props.onClearError}
                      variant="subtle"
                      size="sm"
                      data-testid="strategies-dismiss-btn"
                    >
                      Dismiss
                    </Button>
                  </Group>
                }
              />
            </Stack>
          </Show>
        </StrategiesNav>
      </Box>

      <Show when={props.showCreateModal}>
        <StrategyForm
          mode="create"
          template={props.parentTemplate}
          opened={true}
          onClose={props.onCloseCreateModal}
          onSubmit={props.onCreateStrategy}
        />
      </Show>

      <Show when={props.showEditModal}>
        <StrategyForm
          mode="edit"
          strategy={props.editingStrategy}
          opened={true}
          onClose={props.onCloseEditModal}
          onSubmit={(data) => {
            const editing = props.editingStrategy;
            if (editing) {
              props.onEditStrategy(editing.internal_id ?? Number(editing.id), data);
            }
          }}
          isBotRunning={props.isAnyBotRunning}
        />
      </Show>
    </Box>
  );
}
