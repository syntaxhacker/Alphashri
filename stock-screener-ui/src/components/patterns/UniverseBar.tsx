import { formatNumberIN } from "@/utils/ui-helpers";
import { useState, type ReactNode } from "react";
import { ActionIcon, Box, Button, Divider, Modal, Text, Textarea, Tooltip } from "@/ui";
import { cn } from "@/ui/cn";
import {
  IconAlertTriangle,
  IconClipboardText,
  IconPencil,
  IconPlayerPlay,
} from "@tabler/icons-react";
import type { JobDTO, Universe } from "@/types/chartPatterns";
import { JobStatus } from "./JobStatus";
import { parseSymbolList } from "./parseSymbolList";

export interface UniverseBarProps {
  universes: Universe[];
  universe: string;
  setUniverse: (value: string) => void;
  /** Reserved id of the custom symbol scope (e.g. `"custom"`). */
  customUniverse?: string;
  /** How many symbols the custom scope currently holds (drives the label). */
  customSymbolCount?: number;
  scan: () => void;
  scanning: boolean;
  job: JobDTO | null;
  queuePosition: number | null;
  error: string | null;
  /** Right-side controls rendered in the same toolbar row (timeframe, filters…). */
  actions?: ReactNode;
  /** Scan-status controls rendered next to the scan button (cache, force re-run…). */
  scanActions?: ReactNode;
  /** Apply a pasted symbol list (switches to the custom universe). */
  onPasteSymbols?: (symbols: string[]) => void;
}

/**
 * Scan-scope toolbar.
 *
 * Three fixed rows: scope + action, caller-supplied result controls, and an
 * error line. The scope is a single segmented group (one border, one selected
 * fill) rather than a row of loose pills, so the bar reads as one control and
 * its right-hand status / scan cluster never drifts. The whole bar is sticky
 * (`top: 0`) with a divider so content scrolling underneath stays legible.
 */
export function UniverseBar({
  universes,
  universe,
  setUniverse,
  customUniverse = "custom",
  customSymbolCount = 0,
  scan,
  scanning,
  job,
  queuePosition,
  error,
  actions,
  scanActions,
  onPasteSymbols,
}: UniverseBarProps) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const parsed = parseSymbolList(pasteText);
  const applyPaste = () => {
    if (!parsed.length) return;
    onPasteSymbols?.(parsed);
    setPasteOpen(false);
    setPasteText("");
  };
  // Idle and completed scans are already summarised by the stat strip above
  // ("LAST SCAN …", "LAST CANDLE …"); the inline status is only worth its
  // ~200px while a scan is queued/running or has failed. It stays mounted
  // (display:none) so the `patterns-job-status` contract is preserved.
  const liveStatuses = new Set(["queued", "running", "failed", "cancelled"]);
  const showStatus = scanning || (job != null && liveStatuses.has(job.status));
  const customActive = universe === customUniverse;
  const customCount = customSymbolCount ?? 0;
  const scanDisabled = scanning || (customActive && customCount === 0);
  const scanLabel =
    customActive && customCount > 0
      ? `Scan ${customCount} symbol${customCount === 1 ? "" : "s"}`
      : "Scan again";

  return (
    <Box
      data-testid="patterns-universe-bar"
      className="sticky top-0 z-[5] min-w-0 border-b border-fin-border bg-fin-surface pb-1"
    >
      <Box
        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5"
      >
        <Text
          size="xs"
          c="dimmed"
          className="shrink-0 text-[10px] font-semibold uppercase leading-none tracking-[0.08em] whitespace-nowrap"
        >
          Scope
        </Text>

        <Box
          role="group"
          aria-label="Scan scope"
          className="inline-flex min-w-0 flex-wrap items-stretch gap-0.5 gap-y-[2px] rounded-xl border border-fin-border bg-fin-surface-alt p-0.5"
        >
          {universes.map((u) => {
            const active = universe === u.id;
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => setUniverse(u.id)}
                aria-pressed={active}
                title={u.count > 0 ? `${u.label} · ${formatNumberIN(u.count)} symbols` : u.label}
                data-testid={`patterns-universe-${u.id}`}
                className={cn(
                  "inline-flex cursor-pointer appearance-none items-baseline gap-1 whitespace-nowrap rounded-fin border-0 px-1.5 py-[3px] font-[inherit] text-[11px] leading-[1.25] transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fin-primary",
                  active
                    ? "bg-fin-primary/12 font-semibold text-fin-primary shadow-[inset_0_0_0_1px_var(--color-fin-primary)]"
                    : "font-medium text-fin-text-muted hover:bg-fin-surface hover:text-fin-text",
                )}
              >
                {u.label}
                {u.count > 0 ? (
                  <span
                    className={cn(
                      "text-[9.5px] font-medium tabular-nums",
                      active ? "text-fin-primary opacity-90" : "text-fin-text-muted",
                    )}
                  >
                    {formatNumberIN(u.count)}
                  </span>
                ) : null}
              </button>
            );
          })}

          <Divider orientation="vertical" className="my-0.5" />

          <button
            type="button"
            onClick={() => setUniverse(customUniverse)}
            aria-pressed={customActive}
            data-testid="patterns-universe-custom"
            className={cn(
              "inline-flex cursor-pointer appearance-none items-center gap-1 whitespace-nowrap rounded-fin border-0 px-1.5 py-[3px] font-[inherit] text-[11px] leading-[1.25] transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fin-primary",
              customActive
                ? "bg-fin-primary/12 font-semibold text-fin-primary shadow-[inset_0_0_0_1px_var(--color-fin-primary)]"
                : "font-medium text-fin-text-muted hover:bg-fin-surface hover:text-fin-text",
            )}
          >
            <IconPencil size={11} />
            Custom
            {customCount > 0 ? (
              <span
                className={cn(
                  "text-[9.5px] font-medium tabular-nums",
                  customActive ? "text-fin-primary" : "text-fin-text-muted",
                )}
              >
                {formatNumberIN(customCount)}
              </span>
            ) : null}
          </button>
        </Box>

        {onPasteSymbols ? (
          <Tooltip label="Paste a comma or newline separated symbol list">
            <ActionIcon
              size="xs"
              variant="outline"
              aria-label="Paste symbols"
              onClick={() => setPasteOpen(true)}
              data-testid="patterns-paste-symbols"
              className="shrink-0"
            >
              <IconClipboardText size={14} />
            </ActionIcon>
          </Tooltip>
        ) : null}

        <Box
          className="ml-auto flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-1.5"
        >
          <Box
            data-testid="patterns-job-status-wrap"
            data-visible={showStatus ? "true" : "false"}
            className={cn("min-w-0", showStatus ? "flex" : "hidden")}
          >
            <JobStatus job={job} queuePosition={queuePosition} scanning={scanning} />
          </Box>
          {scanActions}
          <Button
            size="xs"
            variant="filled"
            onClick={scan}
            loading={scanning}
            disabled={scanDisabled}
            leftSection={scanning ? undefined : <IconPlayerPlay size={13} />}
            data-testid="patterns-scan-again"
            className="min-w-[96px] whitespace-nowrap"
          >
            {scanLabel}
          </Button>
        </Box>
      </Box>

      {actions ? (
        <Box
          className="mt-1 flex min-w-0 flex-col gap-0.5 border-t border-fin-border pt-1"
        >
          {actions}
        </Box>
      ) : null}

      {error ? (
        <Box
          role="alert"
          className="mt-1.5 flex items-center gap-1 rounded-fin border-l-[3px] border-fin-negative bg-fin-surface-alt px-1.5 py-[3px] text-fin-negative"
        >
          <IconAlertTriangle size={13} />
          <Text size="xs" c="error" data-testid="patterns-status-line">
            {error}
          </Text>
        </Box>
      ) : null}

      <Modal
        opened={pasteOpen}
        onClose={() => setPasteOpen(false)}
        title="Paste symbols"
        size="sm"
      >
        <Box className="flex flex-col gap-2">
          <Text size="xs" c="dimmed">
            Comma, space or newline separated. Duplicates are removed.
          </Text>
          <Textarea
            value={pasteText}
            onChange={setPasteText}
            placeholder="ASIANPAINT, CIPLA, LT, NTPC…"
            minRows={5}
            autosize
            autoFocus
            data-testid="patterns-paste-symbols-input"
          />
          <Box className="flex justify-end gap-2">
            <Button size="xs" variant="light" onClick={() => setPasteOpen(false)}>
              Cancel
            </Button>
            <Button
              size="xs"
              variant="filled"
              onClick={applyPaste}
              disabled={!parsed.length}
              data-testid="patterns-paste-symbols-apply"
            >
              Use {parsed.length || ""} symbol{parsed.length === 1 ? "" : "s"}
            </Button>
          </Box>
        </Box>
      </Modal>
    </Box>
  );
}
