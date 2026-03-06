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
      <Stack align="center" gap="md" mt="xl">
        <div className="spinner" data-testid="strategies-loading" />
        <Text size="sm" c="dimmed">
          Loading strategy templates...
        </Text>
      </Stack>
    );
  }

  if (templates.length === 0) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} title="No Templates" color="yellow" mt="xl">
        No strategy templates found. Run the migration script to create templates.
      </Alert>
    );
  }

  return (
    <Stack gap="md">
      <Title order={4}>Strategy Templates</Title>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
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
      className="template-card"
      shadow="sm"
      padding="md"
      radius="sm"
      withBorder
      h="100%"
      data-testid="strategy-card"
    >
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Group gap="xs">
            <IconSettings size={18} color="var(--mantine-color-teal-6)" />
            <Text fw={500} size="md">
              {template.name}
            </Text>
          </Group>
          <Badge color="teal" variant="light" size="xs">
            Template
          </Badge>
        </Group>

        {template.description && (
          <Text size="sm" c="dimmed" lineClamp={2}>
            {template.description}
          </Text>
        )}

        <Stack gap={4} mt="xs">
          <Group gap={6}>
            <Text size="xs" c="dimmed">
              Type:
            </Text>
            <Text size="xs" fw={500} className="template-type">
              {template.strategy_type}
            </Text>
          </Group>
          <Group gap={6}>
            <Text size="xs" c="dimmed">
              SL:
            </Text>
            <Text size="xs">{template.sl_pct}%</Text>
            <Text size="xs" c="dimmed">
              TP:
            </Text>
            <Text size="xs">{template.tp_pct}%</Text>
            <Text size="xs" c="dimmed">
              Max Pos:
            </Text>
            <Text size="xs">{template.max_positions}</Text>
          </Group>
        </Stack>

        <Group gap="xs" mt="sm">
          <Button
            size="xs"
            variant="light"
            leftSection={<IconPlus size={14} />}
            onClick={() => onCreateFromTemplate(template)}
            fullWidth
            data-testid="create-from-template-btn"
          >
            Create Variation
          </Button>
        </Group>

        {variations.length > 0 && (
          <Text size="xs" c="dimmed" mt="xs">
            {variations.length} variation{variations.length !== 1 ? "s" : ""} created
          </Text>
        )}
      </Stack>
    </Card>
  );
}
