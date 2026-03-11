import { Box, Stack, Alert, Button, Group } from "@mantine/core";
import { IconAlertCircle, IconRefresh } from "@tabler/icons-react";
import { StrategiesNav } from "./StrategiesNav";
import { TemplatesView } from "./TemplatesView";
import { StrategiesList } from "./StrategiesList";
import { PerformanceView } from "./PerformanceView";
import { StrategyForm } from "./StrategyForm";
import type { StrategiesPageProps } from "./types";

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
        <Stack gap="md" align="center" mt="xl">
          <Alert
            icon={<IconAlertCircle size={16} />}
            title="Error"
            color="red"
            variant="filled"
            data-testid="strategies-error"
          >
            {error}
          </Alert>
          <Group gap="xs">
            <Button
              onClick={onRefresh}
              variant="light"
              color="red"
              leftSection={<IconRefresh size={14} />}
            >
              Retry
            </Button>
            <Button onClick={onClearError} variant="subtle">
              Dismiss
            </Button>
          </Group>
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
    <Box
      h="100%"
      style={{ display: "flex", flexDirection: "column", padding: "var(--mantine-spacing-md)" }}
      data-testid="strategies-view"
    >
      <Box flex="0 0 auto">
        <StrategiesNav activeView={activeView} onChange={onViewChange} />
      </Box>

      <Box flex={1} style={{ minHeight: 0 }}>
        {renderContent()}
      </Box>

      {/* Create Modal */}
      <StrategyForm
        mode="create"
        template={parentTemplate}
        opened={showCreateModal}
        onClose={onCloseCreateModal}
        onSubmit={onCreateStrategy}
      />

      {/* Edit Modal */}
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
      />
    </Box>
  );
}
