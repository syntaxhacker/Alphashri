import { Box, Button, Chip, Text, ToolbarRow } from "@/ui";
import type { JobDTO, Universe } from "@/types/chartPatterns";
import { JobStatus } from "./JobStatus";

export interface UniverseBarProps {
  universes: Universe[];
  universe: string;
  setUniverse: (value: string) => void;
  scan: () => void;
  scanning: boolean;
  job: JobDTO | null;
  queuePosition: number | null;
  error: string | null;
}

/** Universe pills + rescan action + live job status. */
export function UniverseBar({
  universes,
  universe,
  setUniverse,
  scan,
  scanning,
  job,
  queuePosition,
  error,
}: UniverseBarProps) {
  return (
    <Box
      data-testid="patterns-universe-bar"
      sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, bgcolor: "background.paper", p: 1 }}
    >
      <ToolbarRow justify="space-between" gap={1.5}>
        <ToolbarRow gap={0.75}>
          <Text size="xs" fw={700} style={{ textTransform: "uppercase" }} c="dimmed">
            Universe
          </Text>
          {universes.map((u) => (
            <Chip
              key={u.id}
              size="sm"
              variant="light"
              checked={universe === u.id}
              onChange={() => setUniverse(u.id)}
              data-testid={`patterns-universe-${u.id}`}
            >
              {u.label}
              {u.count > 0 ? ` (${u.count.toLocaleString("en-IN")})` : ""}
            </Chip>
          ))}
        </ToolbarRow>
        <ToolbarRow gap={1.5} justify="flex-end">
          <JobStatus job={job} queuePosition={queuePosition} scanning={scanning} />
          <Button
            size="sm"
            variant="filled"
            onClick={scan}
            loading={scanning}
            disabled={scanning}
            data-testid="patterns-scan-again"
          >
            Scan again
          </Button>
        </ToolbarRow>
      </ToolbarRow>
      {error ? (
        <Box sx={{ mt: 0.5 }}>
          <Text size="xs" c="error" data-testid="patterns-status-line">
            {error}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
