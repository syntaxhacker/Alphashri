import { Stack, Group, Text, Loader, Button, Alert } from "@mantine/core";
import { IconAlertCircle, IconDatabaseOff } from "@tabler/icons-react";
import { CompactPanel } from "./compact";

export interface InlineLoaderProps {
  "data-testid"?: string;
  className?: string;
  size?: string;
}

export function InlineLoader({ "data-testid": testId, className, size = "sm" }: InlineLoaderProps) {
  return (
    <Group justify="center" py="xl" data-testid={testId} className={className}>
      <Loader size={size} />
    </Group>
  );
}

interface EmptyStateProps {
  icon?: React.ReactNode;
  emoji?: string;
  title: string;
  description?: string;
  "data-testid"?: string;
  className?: string;
}

export function EmptyState({
  icon,
  emoji,
  title,
  description,
  "data-testid": testId,
  className,
}: EmptyStateProps) {
  return (
    <Stack align="center" gap="xs" py="sm" data-testid={testId} className={className}>
      {icon ??
        (emoji ? <Text size="xl">{emoji}</Text> : <IconDatabaseOff size={40} color="gray" />)}
      <Text fw={600}>{title}</Text>
      {description && (
        <Text size="sm" c="dimmed">
          {description}
        </Text>
      )}
    </Stack>
  );
}

interface ErrorAlertProps {
  title?: string;
  message: string;
  onClose?: () => void;
  "data-testid"?: string;
  className?: string;
  withRetry?: boolean;
  onRetry?: () => void;
}

export function ErrorAlert({
  title = "Error",
  message,
  onClose,
  "data-testid": testId,
  className,
  withRetry,
  onRetry,
}: ErrorAlertProps) {
  return (
    <Alert
      icon={<IconAlertCircle size="1rem" />}
      title={title}
      color="red"
      variant="filled"
      mb="md"
      withCloseButton={!!onClose}
      onClose={onClose}
      data-testid={testId}
      className={className}
    >
      {message}
      {withRetry && onRetry && (
        <Button
          variant="light"
          color="red"
          size="sm"
          onClick={onRetry}
          mt="xs"
          data-testid={testId ? `${testId}-retry` : undefined}
        >
          Retry
        </Button>
      )}
    </Alert>
  );
}

interface EmptyCompactProps {
  icon?: React.ReactNode;
  emoji?: string;
  title: string;
  description?: string;
  "data-testid"?: string;
  className?: string;
  id?: string;
}

export function EmptyCompact({
  icon,
  emoji,
  title,
  description,
  "data-testid": testId,
  className,
  id,
}: EmptyCompactProps) {
  return (
    <CompactPanel data-testid={testId} className={className} id={id}>
      <EmptyState icon={icon} emoji={emoji} title={title} description={description} />
    </CompactPanel>
  );
}
