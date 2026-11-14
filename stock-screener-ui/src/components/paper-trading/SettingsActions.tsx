import { Button, Group } from "@/ui";
import { IconRefresh, IconDeviceFloppy } from "@/components/common/Icons";
interface SettingsActionsProps {
  loading: boolean;
  dirty: boolean;
  onSave: () => void;
  onReset: () => void;
}

export function SettingsActions(props: SettingsActionsProps) {
  return (
    <Group justify="flex-end" gap="xs" className="paper-settings-actions" id="settings-actions">
      <Button
        variant="light"
        color="secondary"
        size="sm"
        onClick={props.onReset}
        loading={props.loading}
        disabled={props.loading}
        leftSection={<IconRefresh size={16} />}
        data-testid="reset-settings-button"
      >
        Reset to Defaults
      </Button>
      <Button
        variant="filled"
        size="sm"
        onClick={props.onSave}
        loading={props.loading}
        disabled={props.loading || !props.dirty}
        leftSection={<IconDeviceFloppy size={16} />}
        data-testid="save-settings-button"
      >
        {props.dirty ? "Save Changes" : "Saved"}
      </Button>
    </Group>
  );
}
