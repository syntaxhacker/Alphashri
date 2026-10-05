import { Box, Progress, Text } from "@/ui";
import type { JobDTO } from "@/types/chartPatterns";

export interface JobStatusProps {
  job: JobDTO | null;
  queuePosition: number | null;
  scanning: boolean;
}

function failureNote(job: JobDTO): string {
  const bits: string[] = [];
  if (job.failed > 0) bits.push(`${job.failed} failed`);
  if (job.skipped > 0) bits.push(`${job.skipped} skipped`);
  return bits.length > 0 ? ` (${bits.join(", ")})` : "";
}

/**
 * Live scan progress / bounded-queue position. Always renders the
 * `patterns-job-status` contract testid, even when idle.
 */
export function JobStatus({ job, queuePosition, scanning }: JobStatusProps) {
  const status = job?.status ?? null;
  const isQueued = scanning ? false : status === "queued";
  const isRunning = scanning || status === "running";
  const position = queuePosition ?? job?.queue_position ?? null;

  let message = "Idle — no scan running";
  if (isQueued) {
    message = position != null ? `Queued — position ${position}` : "Queued";
  } else if (isRunning) {
    const total = job?.total ?? 0;
    const done = job?.done ?? 0;
    message = total > 0 ? `Scanning ${done}/${total}${job ? failureNote(job) : ""}` : "Scanning…";
  } else if (status === "completed") {
    const base = job?.data_through
      ? `Last scan complete · through ${job.data_through}`
      : "Last scan complete";
    // A reused scan finished without re-detecting: say so inline. The full
    // `patterns-scan-reused` notice lives next to Force refresh (PatternsPage)
    // and in ScanProgress, so this stays a text suffix (no duplicate testid).
    message = job?.reused ? `${base} · reused (data unchanged)` : base;
  } else if (status === "failed") {
    message = `Scan failed${job?.error ? `: ${job.error}` : ""}`;
  } else if (status === "cancelled") {
    message = "Scan cancelled";
  }

  const pct = isRunning && job && job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;

  return (
    <Box data-testid="patterns-job-status" sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 200, maxWidth: 320 }}>
      <Text size="xs" c="dimmed" truncate>
        {message}
      </Text>
      {isRunning && job && job.total > 0 ? (
        <Progress value={pct} size="sm" color="primary" aria-label="pattern scan progress" />
      ) : null}
    </Box>
  );
}
