import { useEffect } from "react";
import { ActionIcon, Box, Paper, Text } from "@/ui";
import { IconX } from "@tabler/icons-react";
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
    "border-color": palette.POSITIVE,
  },
  error: {
    icon: "✕",
    color: palette.NEGATIVE,
    "border-color": palette.NEGATIVE,
  },
  warning: {
    icon: "⚠",
    color: palette.WARNING,
    "border-color": palette.WARNING,
  },
  info: {
    icon: "ℹ",
    color: palette.INFO,
    "border-color": palette.INFO,
  },
};

export function NotificationItem({ notification, onDismiss }: NotificationItemProps) {
  const config = typeConfig[notification.type];

  useEffect(() => {
    if (notification.duration && notification.duration > 0) {
      const timer = setTimeout(() => {
        onDismiss(notification.id);
      }, notification.duration);

      return () => clearTimeout(timer);
    }
  }, [notification.id, notification.duration, onDismiss]);

  return (
    <Paper
      role="alert"
      aria-live="polite"
      aria-atomic="true"
      data-testid={`notification-${notification.type}`}
      data-notification-id={notification.id}
      className="flex items-start gap-3 rounded-fin"
      style={{
        padding: "12px 16px",
        borderLeft: `3px solid ${config.borderColor}`,
        "border-radius": 8,
        "box-shadow": `0 4px 12px ${withAlpha(palette.BG, 0.08)}`,
      }}
    >
      <Box aria-hidden="true" style={{ "line-height": 1.5, color: config.color }}>
        {config.icon}
      </Box>
      <Text size="sm" data-testid="notification-message" style={{ flex: 1, "min-width": 0 }}>
        {notification.message}
      </Text>
      <ActionIcon size="sm" onClick={() => onDismiss(notification.id)} aria-label="Dismiss notification" data-testid="notification-dismiss-btn" variant="transparent">
        <IconX size={12} />
      </ActionIcon>
    </Paper>
  );
}
