import { useState } from "react";
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
export function ReplayScanControl({
  onReplayScan,
  disabled = false,
  testIdPrefix = "patterns-replay",
}: ReplayScanControlProps) {
  const [enabled, setEnabled] = useState(false);
  const [asOf, setAsOf] = useState("");
  const [from, setFrom] = useState("");

  const run = (): void => {
    onReplayScan?.({
      asOf: asOf !== "" ? asOf : null,
      from: from !== "" ? from : null,
    });
  };

  return (
    <Box
      data-testid={`${testIdPrefix}-control`}
      sx={{ display: "flex", flexDirection: "column", gap: 1 }}
    >
      <ToolbarRow justify="space-between" gap={8} align="center">
        <Switch
          label="Replay scan"
          size="sm"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          disabled={disabled}
          data-testid={`${testIdPrefix}-toggle`}
        />
        <Button
          size="xs"
          variant="outline"
          onClick={run}
          disabled={disabled || !enabled}
          data-testid={`${testIdPrefix}-run`}
        >
          Run replay
        </Button>
      </ToolbarRow>
      {enabled ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Alert color="warning" data-testid={`${testIdPrefix}-warning`}>
            Replay scans are slower — they recompute history up to the as-of date.
          </Alert>
          <ToolbarRow gap={8} align="center" style={{ flexWrap: "wrap" }}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }}>
              <Text size="xs" c="dimmed">
                As of
              </Text>
              <TextInput
                type="datetime-local"
                value={asOf}
                onChange={(v) => setAsOf(String(v ?? ""))}
                size="sm"
                w={190}
                data-testid={`${testIdPrefix}-asof`}
              />
            </Box>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }}>
              <Text size="xs" c="dimmed">
                From
              </Text>
              <TextInput
                type="datetime-local"
                value={from}
                onChange={(v) => setFrom(String(v ?? ""))}
                size="sm"
                w={190}
                data-testid={`${testIdPrefix}-from`}
              />
            </Box>
          </ToolbarRow>
        </Box>
      ) : null}
    </Box>
  );
}
