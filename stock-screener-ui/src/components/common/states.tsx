import { Show, type JSX } from "solid-js";
import { Alert, Box, Button, Group, Loader, Stack, Text } from "@/ui";
import * as palette from "@/ui/palette";
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
    <Stack
      align="center"
      gap={4}
      py="sm"
      data-testid={props["data-testid"] ?? props.dataTestid}
      className={props.className}
      style={{ "align-items": "center", gap: "4px" }}
    >
      <Box
        className="flex items-center justify-center rounded-fin border border-fin-border bg-fin-surface-alt text-fin-text-muted"
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          width: "36px",
          height: "36px",
          "border-radius": "2px",
          border: `1px solid ${palette.BORDER}`,
          "background-color": palette.SURFACE_ALT,
          color: palette.TEXT_MUTED,
        }}
      >
        {props.icon ?? (props.emoji ? <Text size="md" style={{ "line-height": "1" }}>{props.emoji}</Text> : <IconDatabaseOff size={18} />)}
      </Box>
      <Text size="sm" fw={600} style={{ "line-height": "1.3" }}>
        {props.title}
      </Text>
      <Show when={props.description}>
        <Text size="xs" c="dimmed" style={{ "line-height": "1.35", "max-width": "42ch", "text-align": "center" }}>
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
