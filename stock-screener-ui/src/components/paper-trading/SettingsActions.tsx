import { Button, Group } from "@mantine/core";
import { IconRefresh, IconDeviceFloppy } from "@tabler/icons-react";

interface SettingsActionsProps {
  loading: boolean;
  dirty: boolean;
  onSave: () => void;
  onReset: () => void;
}

export function SettingsActions({ loading, dirty, onSave, onReset }: SettingsActionsProps) {
  return (
    <Group justify="flex-end" gap="xs" className="paper-settings-actions" id="settings-actions">
      <Button
        variant="light"
        color="gray"
        size="sm"
        onClick={onReset}
        loading={loading}
        disabled={loading}
        leftSection={<IconRefresh size={16} />}
        data-testid="reset-settings-button"
      >
        Reset to Defaults
      </Button>
      <Button
        variant="filled"
        size="sm"
        onClick={onSave}
        loading={loading}
        disabled={loading || !dirty}
        leftSection={<IconDeviceFloppy size={16} />}
        data-testid="save-settings-button"
      >
        {dirty ? "Save Changes" : "Saved"}
      </Button>
    </Group>
  );
}
