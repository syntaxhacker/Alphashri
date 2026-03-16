import { Stack, Card, Group, Text, Badge, Button, Alert, SimpleGrid, Title } from "@mantine/core";
import { IconAlertCircle, IconPlus, IconSettings } from "@tabler/icons-react";
import type { TemplatesViewProps, TemplateCardProps } from "./types";

export function TemplatesView({
  templates,
  strategies,
  onCreateFromTemplate,
  isLoading,
}: TemplatesViewProps) {
  if (isLoading) {
    return (
      <Stack align="center" gap="md" mt="xl" className="templates-view-loading">
        <div className="spinner" data-testid="strategies-loading" />
        <Text size="sm" c="dimmed">
          Loading strategy templates...
        </Text>
      </Stack>
    );
  }

  if (templates.length === 0) {
    return (
      <Alert
        icon={<IconAlertCircle size={16} />}
        title="No Templates"
        color="yellow"
        mt="xl"
        className="templates-view-empty"
        data-testid="templates-empty-state"
      >
        No strategy templates found. Run the migration script to create templates.
      </Alert>
    );
  }

  return (
    <Stack gap="md" className="templates-view" id="templates-view" data-testid="templates-view">
      <Title order={4}>Strategy Templates</Title>
      <SimpleGrid
        cols={{ base: 1, sm: 2, lg: 3 }}
        spacing="md"
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
    <Card
      shadow="sm"
      padding="md"
      radius="sm"
      withBorder
      h="100%"
      className="template-card"
      data-testid="strategy-card"
    >
      <Stack gap="xs" className="template-card-content">
        <Group
          justify="space-between"
          align="flex-start"
          wrap="nowrap"
          className="template-card-header"
        >
          <Group gap="xs">
            <IconSettings size={18} color="var(--mantine-color-teal-6)" />
            <Text fw={500} size="md" className="template-card-name">
              {template.name}
            </Text>
          </Group>
          <Badge color="teal" variant="light" size="sm" className="template-card-badge">
            Template
          </Badge>
        </Group>

        {template.description && (
          <Text size="sm" c="dimmed" lineClamp={2} className="template-card-description">
            {template.description}
          </Text>
        )}

        <Stack gap={4} mt="xs" className="template-card-params">
          <Group gap={6}>
            <Text size="sm" c="dimmed">
              Type:
            </Text>
            <Text size="sm" fw={500}>
              {template.strategy_type}
            </Text>
          </Group>
          <Group gap={6}>
            <Text size="sm" c="dimmed">
              SL:
            </Text>
            <Text size="sm">{template.sl_pct}%</Text>
            <Text size="sm" c="dimmed">
              TP:
            </Text>
            <Text size="sm">{template.tp_pct}%</Text>
            <Text size="sm" c="dimmed">
              Max Pos:
            </Text>
            <Text size="sm">{template.max_positions}</Text>
          </Group>
        </Stack>

        <Group gap="xs" mt="sm" className="template-card-actions">
          <Button
            size="sm"
            variant="light"
            leftSection={<IconPlus size={14} />}
            onClick={() => onCreateFromTemplate(template)}
            fullWidth
            data-testid="create-from-template-btn"
            className="template-card-create-btn"
          >
            Create Variation
          </Button>
        </Group>

        {variations.length > 0 && (
          <Text size="sm" c="dimmed" mt="xs" className="template-card-variations">
            {variations.length} variation{variations.length !== 1 ? "s" : ""} created
          </Text>
        )}
      </Stack>
    </Card>
  );
}
