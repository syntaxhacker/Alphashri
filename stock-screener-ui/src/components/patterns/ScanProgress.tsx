import { Box, Progress, Text } from "@/ui";
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
 * Live scan progress: how many symbols of the combo have been processed.
 * Renders nothing when no scan is active (so it never clutters an idle page).
 */
export function ScanProgress({
  job,
  scanning,
  universe,
  timeframe,
  variant = "block",
}: ScanProgressProps) {
  const status = job?.status ?? null;
  const queued = status === "queued" || (!scanning && status === "queued");
  const running = scanning || status === "running";
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
