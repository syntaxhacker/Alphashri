import { createEffect, onCleanup } from "solid-js";
import { ActionIcon, Box, Paper, Text } from "@/ui";
import { IconX } from "../common/Icons";
import * as palette from "@/ui/palette";
import { withAlpha } from "@/utils/color";
import type { Notification } from "../../state/store/notificationsSlice";

type NotificationItemProps = {
  notification: Notification;
  onDismiss: (id: string) => void;
};

export const typeConfig = {
  success: {
    icon: "✓",
    color: palette.POSITIVE,
    borderColor: palette.POSITIVE,
  },
  error: {
    icon: "✕",
    color: palette.NEGATIVE,
    borderColor: palette.NEGATIVE,
  },
  warning: {
    icon: "⚠",
    color: palette.WARNING,
    borderColor: palette.WARNING,
  },
  info: {
    icon: "ℹ",
    color: palette.INFO,
    borderColor: palette.INFO,
  },
};

export function NotificationItem(props: NotificationItemProps) {
  const config = () => typeConfig[props.notification.type];

  createEffect(() => {
    const duration = props.notification.duration;
    if (duration && duration > 0) {
      const id = props.notification.id;
      const timer = setTimeout(() => {
        props.onDismiss(id);
      }, duration);
      onCleanup(() => clearTimeout(timer));
    }
  });

  return (
    <Paper
      role="alert"
      aria-live="polite"
      aria-atomic="true"
      data-testid={`notification-${props.notification.type}`}
      data-notification-id={props.notification.id}
      className="flex items-start gap-3 rounded-fin"
      style={{
        padding: "12px 16px",
        borderLeft: `3px solid ${config().borderColor}`,
        borderRadius: 8,
        boxShadow: `0 4px 12px ${withAlpha(palette.BG, 0.08)}`,
      }}
    >
      <Box aria-hidden="true" style={{ lineHeight: 1.5, color: config().color }}>
        {config().icon}
      </Box>
      <Text size="sm" data-testid="notification-message" style={{ flex: 1, minWidth: 0 }}>
        {props.notification.message}
      </Text>
      <ActionIcon size="sm" onClick={() => props.onDismiss(props.notification.id)} aria-label="Dismiss notification" data-testid="notification-dismiss-btn" variant="transparent">
        <IconX size={12} />
      </ActionIcon>
    </Paper>
  );
}
