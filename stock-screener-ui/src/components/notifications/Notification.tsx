import { useEffect } from "react";
import { Box, Paper, IconButton, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import type { Notification } from "../../state/store/notificationsSlice";

type NotificationItemProps = {
  notification: Notification;
  onDismiss: (id: string) => void;
};

export const typeConfig = {
  success: {
    icon: "✓",
    color: "success.main" as const,
    borderColor: "success.main" as const,
  },
  error: {
    icon: "✕",
    color: "error.main" as const,
    borderColor: "error.main" as const,
  },
  warning: {
    icon: "⚠",
    color: "warning.main" as const,
    borderColor: "warning.main" as const,
  },
  info: {
    icon: "ℹ",
    color: "info.main" as const,
    borderColor: "info.main" as const,
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
      sx={{
        display: "flex",
        alignItems: "flex-start",
        gap: 1,
        p: "12px 16px",
        borderLeft: "3px solid",
        borderLeftColor: config.borderColor,
        borderRadius: 1,
        boxShadow: "0 4px 12px rgba(15,23,42,0.08)",
      }}
    >
      <Box aria-hidden="true" sx={{ color: config.color, lineHeight: 1.5 }}>
        {config.icon}
      </Box>
      <Typography variant="body2" data-testid="notification-message" sx={{ flex: 1, minWidth: 0 }}>
        {notification.message}
      </Typography>
      <IconButton size="small" onClick={() => onDismiss(notification.id)} aria-label="Dismiss notification" data-testid="notification-dismiss-btn">
        <CloseIcon fontSize="small" />
      </IconButton>
    </Paper>
  );
}
