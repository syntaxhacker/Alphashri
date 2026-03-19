import { Stack, Group, Text, Button, SimpleGrid } from "@mantine/core";
import { IconAlertCircle, IconPlus, IconSettings } from "@tabler/icons-react";
import type { TemplatesViewProps, TemplateCardProps } from "./types";
import { CompactPanel } from "../common/compact";

export function TemplatesView({
  templates,
  strategies,
  onCreateFromTemplate,
  isLoading,
}: TemplatesViewProps) {
  if (isLoading) {
    return (
      <CompactPanel
        className="templates-view-loading"
        testId="templates-loading-state"
        title={
          <Group gap="xs" wrap="nowrap">
            <div className="spinner" data-testid="strategies-loading" />
            <Text fw={600} size="sm">
              Loading templates
            </Text>
          </Group>
        }
        description="Fetching strategy templates and variations"
      />
    );
  }

  if (templates.length === 0) {
    return (
      <CompactPanel
        className="templates-view-empty"
        testId="templates-empty-state"
        title={
          <Group gap="xs" wrap="nowrap">
            <IconAlertCircle size={18} />
            <Text fw={600} size="sm">
              No templates
            </Text>
          </Group>
        }
        description="Run the migration script to create the strategy templates first."
      />
    );
  }

  return (
    <Stack gap="sm" className="templates-view" id="templates-view" data-testid="templates-view">
      <SimpleGrid
        cols={{ base: 1, sm: 2, lg: 3 }}
        spacing="sm"
        className="templates-grid"
        data-testid="templates-grid"
      >
        {templates.map((template) => {
          const variations = strategies.filter(
            (s) => s.parent_id === template.id && !s.is_template,
          );
          return (
            <TemplateCard
              key={template.id}
              template={template}
              variations={variations}
              onCreateFromTemplate={onCreateFromTemplate}
            />
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}

function TemplateCard({ template, variations, onCreateFromTemplate }: TemplateCardProps) {
  return (
    <CompactPanel
      title={template.name}
      description={template.description}
      action={
        <Button
          size="xs"
          variant="light"
          leftSection={<IconPlus size={13} />}
          onClick={() => onCreateFromTemplate(template)}
          data-testid="create-from-template-btn"
          className="template-card-create-btn"
        >
          Create
        </Button>
      }
      className="template-card"
      id={`template-card-${template.id}`}
      testId="strategy-card"
    >
      <Stack gap={6} className="template-card-content">
        <Group gap="xs" wrap="wrap" className="template-card-header">
          <IconSettings size={16} color="var(--mantine-color-teal-6)" />
          <Text size="sm" fw={600} className="template-card-name">
            {template.name}
          </Text>
        </Group>
        <Group gap="xs" wrap="wrap" className="template-card-params">
          <Text size="xs" c="dimmed">
            Type
          </Text>
          <Text size="xs" fw={500}>
            {template.strategy_type}
          </Text>
          <Text size="xs" c="dimmed">
            SL {template.sl_pct}%
          </Text>
          <Text size="xs" c="dimmed">
            TP {template.tp_pct}%
          </Text>
          <Text size="xs" c="dimmed">
            Max Pos {template.max_positions}
          </Text>
        </Group>
        {variations.length > 0 && (
          <Text size="xs" c="dimmed" className="template-card-variations">
            {variations.length} variation{variations.length !== 1 ? "s" : ""} created
          </Text>
        )}
      </Stack>
    </CompactPanel>
  );
}
