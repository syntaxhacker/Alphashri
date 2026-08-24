import { Box, Stack, Button, Group, Text } from "@/ui";
import Container from "@mui/material/Container";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import { FIN_OUTER_PAD } from "@/ui/palette";
import { IconAlertCircle, IconRefresh } from "@tabler/icons-react";
import { StrategiesNav } from "./StrategiesNav";
import { TemplateTreeView } from "./TemplateTreeView";
import { PerformanceView } from "./PerformanceView";
import { StrategyForm } from "./StrategyForm";
import type { StrategiesPageProps } from "./types";
import { CompactPanel } from "../common/compact";

export function StrategiesPage({
  strategies,
  templates,
  performance,
  bots: _bots,
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
  onOpenCreateModal: _onOpenCreateModal,
  onOpenEditModal,
  onCloseCreateModal,
  onCloseEditModal,
  onCreateFromTemplate,
  onEditTemplate,
  onSyncVariations,
  onSelectStrategy,
  onUpdate,
  onRefresh,
  onClearError,
  isAnyBotRunning,
}: StrategiesPageProps) {
  const renderContent = () => {
    if (error) {
      return (
        <Stack spacing={1} alignItems="stretch" sx={{ mt: 1 }}>
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
                <Button
                  onClick={onClearError}
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
      );
    }
    switch (activeView) {
      case "tree":
        return (
          <TemplateTreeView
            templates={templates}
            strategies={strategies}
            onEditTemplate={onEditTemplate!}
            onSyncVariations={onSyncVariations!}
            onCreateFromTemplate={onCreateFromTemplate}
            onEditStrategy={onOpenEditModal}
            onDeleteStrategy={onDeleteStrategy}
            onUpdate={onUpdate}
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
    <Container maxWidth="xl" sx={{ py: `${FIN_OUTER_PAD}px`, height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }} data-testid="strategies-view" id="strategies-main">
      <Stack spacing={1} sx={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
        <Box sx={{ flex: "0 0 auto" }} data-testid="strategies-nav-container">
          <StrategiesNav activeView={activeView} onChange={onViewChange} />
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }} data-testid="strategies-content" id="strategies-content">
          <Box sx={{ flex: 1, overflow: "auto", minHeight: 0 }}>{renderContent()}</Box>
        </Box>

        {showCreateModal && (
          <StrategyForm
            mode="create"
            template={parentTemplate}
            opened={true}
            onClose={onCloseCreateModal}
            onSubmit={onCreateStrategy}
            data-testid="strategies-create-modal"
          />
        )}

        {showEditModal && (
          <StrategyForm
            mode="edit"
            strategy={editingStrategy}
            opened={true}
            onClose={onCloseEditModal}
            onSubmit={(data) => {
              if (editingStrategy) {
                onEditStrategy(editingStrategy.internal_id ?? Number(editingStrategy.id), data);
              }
            }}
            isBotRunning={isAnyBotRunning}
            data-testid="strategies-edit-modal"
          />
        )}
      </Stack>
    </Container>
  );
}
