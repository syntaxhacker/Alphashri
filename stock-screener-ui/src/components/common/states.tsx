import type { JSX } from "solid-js";
import { Stack, Group, Text, Loader, Button, Alert } from "@/ui";
import { IconAlertCircle, IconDatabaseOff } from "@/components/common/Icons";
import { CompactPanel } from "./compact";

export interface InlineLoaderProps {
  "data-testid"?: string;
  className?: string;
  size?: string;
  message?: string;
  showSpinner?: boolean;
  children?: JSX.Element;
}

export function InlineLoader({
  dataTestid: testId,
  className,
  size = "sm",
  message,
  showSpinner = true,
  children,
}: InlineLoaderProps) {
  return (
    <Group justify="center" direction="column" gap="xs" py="xl" data-testid={testId} className={className}>
      {showSpinner && <Loader size={size} />}
      {children || (message && <Text size="xs" c="dimmed">{message}</Text>)}
    </Group>
  );
}

interface EmptyStateProps {
  icon?: JSX.Element;
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
  dataTestid: testId,
  className,
}: EmptyStateProps) {
  return (
    <Stack align="center" gap="xs" py="sm" data-testid={testId} className={className}>
      {icon ?? (emoji ? <Text size="xl">{emoji}</Text> : <IconDatabaseOff size={40} color="secondary" />)}
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
  dataTestid: testId,
  className,
  withRetry,
  onRetry,
}: ErrorAlertProps) {
  return (
    <Alert
      icon={<IconAlertCircle size="1rem" />}
      title={title}
      color="error"
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
          variant="filled"
          color="error"
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
  icon?: JSX.Element;
  emoji?: string;
  title: string;
  description?: string;
  "data-testid"?: string;
  className?: string;
  id?: string;
  children?: JSX.Element;
}

export function EmptyCompact({
  icon,
  emoji,
  title,
  description,
  dataTestid: testId,
  className,
  id,
  children,
}: EmptyCompactProps) {
  return (
    <CompactPanel data-testid={testId} className={className} id={id} description={description}>
      <EmptyState icon={icon} emoji={emoji} title={title} />
      {children}
    </CompactPanel>
  );
}
