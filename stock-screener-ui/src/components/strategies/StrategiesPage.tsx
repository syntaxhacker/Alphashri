import { Box, Stack, Button, Group, Text } from "@mantine/core";
import { IconAlertCircle, IconRefresh } from "@tabler/icons-react";
import { StrategiesNav } from "./StrategiesNav";
import { TemplatesView } from "./TemplatesView";
import { StrategiesList } from "./StrategiesList";
import { PerformanceView } from "./PerformanceView";
import { StrategyForm } from "./StrategyForm";
import type { StrategiesPageProps } from "./types";
import { CompactPage, CompactPanel } from "../common/compact";

export function StrategiesPage({
  strategies,
  templates,
  performance,
  bots,
  isLoading,
  error,
  activeView,
  showCreateModal,
  showEditModal,
  editingStrategy,
  parentTemplate,
  onViewChange,
  onCreateStrategy,
  onEditStrategy,
  onDeleteStrategy,
  onSetActiveStrategy,
  onOpenCreateModal,
  onOpenEditModal,
  onCloseCreateModal,
  onCloseEditModal,
  onCreateFromTemplate,
  onSelectStrategy,
  onRefresh,
  onClearError,
}: StrategiesPageProps) {
  const renderContent = () => {
    if (error) {
      return (
        <Stack gap="sm" align="stretch" mt="sm" className="strategies-error-container">
          <CompactPanel
            testId="strategies-error"
            title={
              <Group gap="xs" wrap="nowrap">
                <IconAlertCircle size={18} />
                <Text fw={600} size="sm">
                  Strategies failed to load
                </Text>
              </Group>
            }
            description={error}
            action={
              <Group gap="xs">
                <Button
                  onClick={onRefresh}
                  variant="light"
                  color="red"
                  size="sm"
                  leftSection={<IconRefresh size={14} />}
                  data-testid="strategies-retry-btn"
                >
                  Retry
                </Button>
                <Button onClick={onClearError} variant="subtle" size="sm" data-testid="strategies-dismiss-btn">
                  Dismiss
                </Button>
              </Group>
            }
          />
        </Stack>
      );
    }

    switch (activeView) {
      case "templates":
        return (
          <TemplatesView
            templates={templates}
            strategies={strategies}
            onCreateFromTemplate={onCreateFromTemplate}
            isLoading={isLoading}
          />
        );
      case "list":
        return (
          <StrategiesList
            strategies={strategies}
            templates={templates}
            onEdit={onOpenEditModal}
            onDelete={onDeleteStrategy}
            onSetActive={onSetActiveStrategy}
            isLoading={isLoading}
          />
        );
      case "performance":
        return (
          <PerformanceView
            performance={performance}
            strategies={strategies}
            onSelectStrategy={onSelectStrategy}
            isLoading={isLoading}
          />
        );
      default:
        return null;
    }
  };

  return (
    <CompactPage>
      <Box
        h="100%"
        className="strategies-page"
        id="strategies-main"
        style={{ display: "flex", flexDirection: "column", gap: "var(--mantine-spacing-sm)" }}
        data-testid="strategies-view"
      >
        <Box
          flex="0 0 auto"
          className="strategies-nav-container"
          data-testid="strategies-nav-container"
        >
          <StrategiesNav activeView={activeView} onChange={onViewChange} />
        </Box>

        <Box
          flex={1}
          className="strategies-content"
          id="strategies-content"
          style={{ minHeight: 0, display: "flex", overflow: "hidden" }}
          data-testid="strategies-content"
        >
          <Box style={{ flex: 1, overflow: "auto", minHeight: 0 }}>{renderContent()}</Box>
        </Box>

        <StrategyForm
          mode="create"
          template={parentTemplate}
          opened={showCreateModal}
          onClose={onCloseCreateModal}
          onSubmit={onCreateStrategy}
          data-testid="strategies-create-modal"
        />

        <StrategyForm
          mode="edit"
          strategy={editingStrategy}
          opened={showEditModal}
          onClose={onCloseEditModal}
          onSubmit={(data) => {
            if (editingStrategy) {
              onEditStrategy(editingStrategy.internal_id ?? Number(editingStrategy.id), data);
            }
          }}
          data-testid="strategies-edit-modal"
        />
      </Box>
    </CompactPage>
  );
}
