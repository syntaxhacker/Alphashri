import { Show, createSignal } from "solid-js";
import { Alert, Box, Button, Switch, Text, TextInput, ToolbarRow } from "@/ui";

export interface ReplayScanArgs {
  asOf: string | null;
  from: string | null;
}

export interface ReplayScanControlProps {
  /** Called with the replay window when the user runs an as-of scan. */
  onReplayScan?: (args: ReplayScanArgs) => void;
  disabled?: boolean;
  /** Testid prefix namespace; defaults to the `patterns-replay-*` contract ids. */
  testIdPrefix?: string;
}

/**
 * As-of replay scan control: a switch enabling replay mode plus From/To
 * `datetime-local` inputs. Running calls back with `{ asOf, from }` so the
 * parent can `startScan({ ..., as_of_date: asOf, from_date: from })`.
 * Replay scans recompute history up to the cutoff, so they are slower —
 * the warning says so whenever replay mode is on.
 */
export function ReplayScanControl(props: ReplayScanControlProps) {
  const [enabled, setEnabled] = createSignal(false);
  const [asOf, setAsOf] = createSignal("");
  const [from, setFrom] = createSignal("");
  const testIdPrefix = () => props.testIdPrefix ?? "patterns-replay";
  const disabled = () => props.disabled ?? false;

  const run = (): void => {
    props.onReplayScan?.({
      asOf: asOf() !== "" ? asOf() : null,
      from: from() !== "" ? from() : null,
    });
  };

  return (
    <Box
      data-testid={`${testIdPrefix()}-control`}
      className="flex flex-col gap-2"
    >
      <ToolbarRow justify="space-between" gap={8}>
        <Switch
          label="Replay scan"
          size="sm"
          checked={enabled()}
          onChange={(e) => setEnabled((e.currentTarget as HTMLInputElement).checked)}
          disabled={disabled()}
          data-testid={`${testIdPrefix()}-toggle`}
        />
        <Show when={enabled()}>
          <Button
            size="xs"
            variant="outline"
            onClick={run}
            disabled={disabled()}
            data-testid={`${testIdPrefix()}-run`}
          >
            Run replay
          </Button>
        </Show>
      </ToolbarRow>
      <Show when={enabled()}>
        <Box className="flex flex-col gap-2">
          <Alert color="warning" data-testid={`${testIdPrefix()}-warning`}>
            Replay scans are slower — they recompute history up to the as-of date.
          </Alert>
          <ToolbarRow gap={8} style={{ "flex-wrap": "wrap" }}>
            <Box className="flex min-w-0 flex-col gap-1">
              <Text size="xs" c="dimmed">
                As of
              </Text>
              <TextInput
                type="datetime-local"
                value={asOf()}
                onChange={(v) => setAsOf(String(v ?? ""))}
                size="sm"
                w={190}
                data-testid={`${testIdPrefix()}-asof`}
              />
            </Box>
            <Box className="flex min-w-0 flex-col gap-1">
              <Text size="xs" c="dimmed">
                From
              </Text>
              <TextInput
                type="datetime-local"
                value={from()}
                onChange={(v) => setFrom(String(v ?? ""))}
                size="sm"
                w={190}
                data-testid={`${testIdPrefix()}-from`}
              />
            </Box>
          </ToolbarRow>
        </Box>
      </Show>
    </Box>
  );
}
