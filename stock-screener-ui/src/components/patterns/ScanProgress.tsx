import { Alert, Box, Button, Progress, Text } from "@/ui";
import type { JobDTO } from "@/types/chartPatterns";

export interface ScanProgressProps {
  job: JobDTO | null;
  scanning: boolean;
  universe?: string;
  timeframe?: string;
  /**
   * `"block"` = large centered panel for the loading/empty grid state.
   * `"banner"` = full-width row above the grid (always visible while scanning).
   * `"inline"` = compact one-liner (bar + count).
   */
  variant?: "block" | "banner" | "inline";
  /** Optional re-run action shown next to the reused-scan notice. */
  onForceRefresh?: () => void;
}

/** Friendly universe labels for the progress line (ids are lowercase). */
const UNIVERSE_LABELS: Record<string, string> = {
  nifty50: "NIFTY 50",
  nifty100: "NIFTY 100",
  nifty200: "NIFTY 200",
  nifty500: "NIFTY 500",
  all_equity: "All NSE Equity",
  nse_fo: "NSE F&O",
};

/** Human label for the combo being scanned, e.g. "NIFTY 50 · 1h". */
function comboLabel(universe?: string, timeframe?: string): string {
  const id = universe ?? "";
  const u = UNIVERSE_LABELS[id] ?? id.replace(/_/g, " ").toUpperCase();
  const t = timeframe ?? "";
  return [u, t].filter(Boolean).join(" · ");
}

function etaLabel(job: JobDTO | null): string | null {
  if (!job || !job.started_at || job.done <= 0 || job.total <= 0) return null;
  const started = Date.parse(job.started_at);
  if (Number.isNaN(started)) return null;
  const elapsed = Date.now() - started;
  const perItem = elapsed / job.done;
  const remaining = Math.max(0, job.total - job.done);
  const ms = perItem * remaining;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `~${s}s left`;
  return `~${Math.round(s / 60)} min left`;
}

/**
 * Human age of a reused scan, e.g. `"12 min ago"`. Prefers the server's
 * `reused_age_sec`; falls back to `reused_finished_at`/`finished_at` relative
 * to now. Null when no age signal is available.
 */
export function formatReusedAge(job: JobDTO, now: number = Date.now()): string | null {
  const direct = job.reused_age_sec;
  const fromDirect =
    direct != null && Number.isFinite(direct) && direct >= 0 ? Math.round(direct) : null;
  const stamp = job.reused_finished_at ?? job.finished_at ?? null;
  let totalSec = fromDirect;
  if (totalSec == null && stamp) {
    const ts = Date.parse(stamp);
    if (!Number.isNaN(ts)) totalSec = Math.max(0, Math.round((now - ts) / 1000));
  }
  if (totalSec == null) return null;
  if (totalSec < 60) return `${totalSec}s ago`;
  const minutes = Math.round(totalSec / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

export interface ReusedScanNoticeProps {
  job: JobDTO;
  /** Optional re-run action rendered as a compact button next to the notice. */
  onForceRefresh?: () => void;
}

/**
 * Notice shown when a non-forced scan reused a previous scan without
 * re-detecting (data unchanged). Pairs with the Force refresh action.
 */
export function ReusedScanNotice({ job, onForceRefresh }: ReusedScanNoticeProps) {
  if (!job.reused) return null;
  const age = formatReusedAge(job);
  const when = age ? ` from ${age}` : "";
  return (
    <Alert color="info" data-testid="patterns-scan-reused">
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Text size="xs">{`Reused scan${when} — data unchanged. Force to re-run.`}</Text>
        {onForceRefresh ? (
          <Button size="xs" variant="outline" onClick={onForceRefresh} data-testid="patterns-scan-reused-force">
            Force re-run
          </Button>
        ) : null}
      </Box>
    </Alert>
  );
}

/**
 * Live scan progress: how many symbols of the combo have been processed.
 * Renders nothing when no scan is active (so it never clutters an idle page),
 * except for the reused-scan notice which explains a silently reused scan.
 */
export function ScanProgress({
  job,
  scanning,
  universe,
  timeframe,
  variant = "block",
  onForceRefresh,
}: ScanProgressProps) {
  const status = job?.status ?? null;
  const queued = status === "queued" || (!scanning && status === "queued");
  const running = scanning || status === "running";
  if (job?.reused && !running && !queued) {
    return <ReusedScanNotice job={job} onForceRefresh={onForceRefresh} />;
  }
  if (!running && !queued) return null;

  const total = job?.total ?? 0;
  const done = job?.done ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const combo = comboLabel(universe, timeframe);
  const position = job?.queue_position ?? null;

  if (queued && !running) {
    return (
      <Box
        data-testid="patterns-scan-progress"
        sx={{ display: "flex", flexDirection: "column", gap: 1, alignItems: "center", maxWidth: 460, mx: "auto" }}
      >
        <Text size="sm" fw={600}>
          Queued{combo ? ` — ${combo}` : ""}
          {position != null ? ` (position ${position})` : ""}
        </Text>
        <Text size="xs" c="dimmed">
          Waiting for a free scan slot…
        </Text>
      </Box>
    );
  }

  const countText = total > 0 ? `${done} / ${total} stocks` : "starting…";
  const eta = etaLabel(job);

  if (variant === "banner") {
    return (
      <Box
        data-testid="patterns-scan-progress"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          p: 1,
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
          bgcolor: "background.paper",
          minWidth: 0,
        }}
      >
        <Text size="xs" fw={700} style={{ whiteSpace: "nowrap" }}>
          Scanning{combo ? ` ${combo}` : ""}…
        </Text>
        <Box sx={{ flex: 1, minWidth: 120 }}>
          <Progress value={pct} size="sm" color="primary" aria-label="pattern scan progress" />
        </Box>
        <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }} data-testid="patterns-scan-progress-count">
          {total > 0 ? `${done}/${total} stocks · ${pct}%` : "starting…"}
          {eta ? ` · ${eta}` : ""}
        </Text>
      </Box>
    );
  }

  if (variant === "inline") {
    return (
      <Box data-testid="patterns-scan-progress" sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 180 }}>
        <Text size="xs" c="dimmed" truncate>
          Scanning{combo ? ` ${combo}` : ""} · {countText}
          {eta ? ` · ${eta}` : ""}
        </Text>
        <Progress value={pct} size="sm" color="primary" aria-label="pattern scan progress" />
      </Box>
    );
  }

  return (
    <Box
      data-testid="patterns-scan-progress"
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
        alignItems: "center",
        width: "100%",
        maxWidth: 520,
        mx: "auto",
        py: 2,
        px: 3,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        bgcolor: "background.paper",
      }}
    >
      <Text size="sm" fw={700}>
        Scanning{combo ? ` ${combo}` : ""}…
      </Text>
      <Box sx={{ width: "100%" }}>
        <Progress
          value={pct}
          size="lg"
          color="primary"
          aria-label="pattern scan progress"
          data-testid="patterns-scan-progress-bar"
        />
      </Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", width: "100%", gap: 2 }}>
        <Text size="sm" fw={600} data-testid="patterns-scan-progress-count">
          {total > 0 ? `${done} / ${total} stocks` : "Starting…"}
        </Text>
        <Text size="xs" c="dimmed">
          {total > 0 ? `${pct}%` : ""}
          {eta ? ` · ${eta}` : ""}
        </Text>
      </Box>
      <Text size="xs" c="dimmed" ta="center">
        Results appear as each stock finishes. You can keep this tab open.
      </Text>
    </Box>
  );
}
