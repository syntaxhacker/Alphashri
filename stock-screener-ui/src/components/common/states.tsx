import { Show, type JSX } from "solid-js";
import { Stack, Group, Text, Loader, Button, Alert } from "@/ui";
import { IconAlertCircle, IconDatabaseOff } from "@/components/common/Icons";
import { CompactPanel } from "./compact";

export interface InlineLoaderProps {
  "data-testid"?: string;
  /** @deprecated kebab-case `data-testid` is the supported spelling. */
  dataTestid?: string;
  className?: string;
  size?: string;
  message?: string;
  showSpinner?: boolean;
  children?: JSX.Element;
}

export function InlineLoader(props: InlineLoaderProps) {
  const testId = () => props["data-testid"] ?? props.dataTestid;
  const size = () => props.size ?? "sm";
  const showSpinner = () => props.showSpinner ?? true;
  return (
    <Group justify="center" direction="column" gap="xs" py="xl" data-testid={testId()} className={props.className}>
      {showSpinner() && <Loader size={size()} />}
      {props.children || (props.message && <Text size="xs" c="dimmed">{props.message}</Text>)}
    </Group>
  );
}

interface EmptyStateProps {
  icon?: JSX.Element;
  emoji?: string;
  title: string;
  description?: string;
  "data-testid"?: string;
  /** @deprecated kebab-case `data-testid` is the supported spelling. */
  dataTestid?: string;
  className?: string;
}

export function EmptyState(props: EmptyStateProps) {
  return (
    <Stack align="center" gap="xs" py="sm" data-testid={props["data-testid"] ?? props.dataTestid} className={props.className}>
      {props.icon ?? (props.emoji ? <Text size="xl">{props.emoji}</Text> : <IconDatabaseOff size={40} color="secondary" />)}
      <Text fw={600}>{props.title}</Text>
      <Show when={props.description}>
        <Text size="sm" c="dimmed">
          {props.description}
        </Text>
      </Show>
    </Stack>
  );
}

interface ErrorAlertProps {
  title?: string;
  message: string;
  onClose?: () => void;
  "data-testid"?: string;
  /** @deprecated kebab-case `data-testid` is the supported spelling. */
  dataTestid?: string;
  className?: string;
  withRetry?: boolean;
  onRetry?: () => void;
}

export function ErrorAlert(props: ErrorAlertProps) {
  const testId = () => props["data-testid"] ?? props.dataTestid;
  return (
    <Alert
      icon={<IconAlertCircle size="1rem" />}
      title={props.title ?? "Error"}
      color="error"
      variant="filled"
      mb="md"
      withCloseButton={!!props.onClose}
      onClose={props.onClose}
      data-testid={testId()}
      className={props.className}
    >
      {props.message}
      <Show when={props.withRetry && props.onRetry}>
        <Button
          variant="filled"
          color="error"
          size="sm"
          onClick={props.onRetry}
          mt="xs"
          data-testid={testId() ? `${testId()}-retry` : undefined}
        >
          Retry
        </Button>
      </Show>
    </Alert>
  );
}

interface EmptyCompactProps {
  icon?: JSX.Element;
  emoji?: string;
  title: string;
  description?: string;
  "data-testid"?: string;
  /** @deprecated kebab-case `data-testid` is the supported spelling. */
  dataTestid?: string;
  className?: string;
  id?: string;
  children?: JSX.Element;
}

export function EmptyCompact(props: EmptyCompactProps) {
  return (
    <CompactPanel data-testid={props["data-testid"] ?? props.dataTestid} className={props.className} id={props.id} description={props.description}>
      <EmptyState icon={props.icon} emoji={props.emoji} title={props.title} />
      {props.children}
    </CompactPanel>
  );
}
