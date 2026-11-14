import { formatNumberIN } from "@/utils/ui-helpers";
import { createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { Box, Divider, Text, Textarea, Tooltip } from "@/ui";
import { cn } from "@/ui/cn";
import {
  IconAlertTriangle,
  IconClipboardText,
  IconPencil,
  IconPlayerPlay,
  IconX,
} from "@/patterns/icons";
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
  actions?: JSX.Element;
  /** Scan-status controls rendered next to the scan button (cache, force re-run…). */
  scanActions?: JSX.Element;
  /** Apply a pasted symbol list (switches to the custom universe). */
  onPasteSymbols?: (symbols: string[]) => void;
}

/** Inline spinner matching the shared Button's loading affordance. */
function Spinner() {
  return (
    <span
      className="inline-block size-3 animate-spin rounded-full border-2 border-fin-text border-t-transparent"
      aria-hidden="true"
    />
  );
}

/**
 * Scan-scope toolbar.
 *
 * One bordered context band: scope + action on a single row, with the
 * right-hand status / scan cluster pushed by `ml-auto` so it never becomes an
 * orphan row. The caller's tools are rendered directly below (no extra bordered
 * column or divider — the parent already owns that row), and the error line
 * only appears when a scan fails. The whole block is sticky (`top: 0`).
 */
export function UniverseBar(props: UniverseBarProps) {
  const [pasteOpen, setPasteOpen] = createSignal(false);
  const [pasteText, setPasteText] = createSignal("");
  const parsed = createMemo(() => parseSymbolList(pasteText()));
  const customUniverse = () => props.customUniverse ?? "custom";
  const customSymbolCount = () => props.customSymbolCount ?? 0;

  const applyPaste = () => {
    if (!parsed().length) return;
    props.onPasteSymbols?.(parsed());
    setPasteOpen(false);
    setPasteText("");
  };

  // Idle and completed scans are already summarised by the stat strip above
  // ("LAST SCAN …", "LAST CANDLE …"); the inline status is only worth its
  // ~200px while a scan is queued/running or has failed. It stays mounted
  // (display:none) so the `patterns-job-status` contract is preserved.
  const liveStatuses = new Set(["queued", "running", "failed", "cancelled"]);
  const showStatus = () => props.scanning || (props.job != null && liveStatuses.has(props.job.status));
  const customActive = () => props.universe === customUniverse();
  const scanDisabled = () => props.scanning || (customActive() && customSymbolCount() === 0);
  const scanLabel = () =>
    customActive() && customSymbolCount() > 0
      ? `Scan ${customSymbolCount()} symbol${customSymbolCount() === 1 ? "" : "s"}`
      : "Scan again";

  return (
    <Box className="sticky top-0 z-[5] min-w-0 bg-fin-surface pb-1">
      <Box
        data-testid="patterns-universe-bar"
        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-fin-border bg-fin-surface"
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
          <For each={props.universes}>
            {(u) => {
              const active = () => props.universe === u.id;
              return (
                <button
                  type="button"
                  onClick={() => props.setUniverse(u.id)}
                  aria-pressed={active()}
                  title={u.count > 0 ? `${u.label} · ${formatNumberIN(u.count)} symbols` : u.label}
                  data-testid={`patterns-universe-${u.id}`}
                  className={cn(
                    "inline-flex cursor-pointer appearance-none items-baseline gap-1 whitespace-nowrap rounded-fin border-0 px-1 py-[3px] font-[inherit] text-[10px] leading-[1.25] transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fin-primary",
                    active()
                      ? "bg-fin-primary/12 font-semibold text-fin-primary shadow-[inset_0_0_0_1px_var(--color-fin-primary)]"
                      : "font-medium text-fin-text-muted hover:bg-fin-surface hover:text-fin-text",
                  )}
                >
                  {u.label}
                  <Show when={u.count > 0}>
                    <span
                      className={cn(
                        "text-[9px] font-medium tabular-nums",
                        active() ? "text-fin-primary opacity-90" : "text-fin-text-muted",
                      )}
                    >
                      {formatNumberIN(u.count)}
                    </span>
                  </Show>
                </button>
              );
            }}
          </For>

          <Divider orientation="vertical" className="my-0.5" />

          <button
            type="button"
            onClick={() => props.setUniverse(customUniverse())}
            aria-pressed={customActive()}
            data-testid="patterns-universe-custom"
            className={cn(
              "inline-flex cursor-pointer appearance-none items-center gap-1 whitespace-nowrap rounded-fin border-0 px-1 py-[3px] font-[inherit] text-[10px] leading-[1.25] transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fin-primary",
              customActive()
                ? "bg-fin-primary/12 font-semibold text-fin-primary shadow-[inset_0_0_0_1px_var(--color-fin-primary)]"
                : "font-medium text-fin-text-muted hover:bg-fin-surface hover:text-fin-text",
            )}
          >
            <IconPencil size={11} />
            Custom
            <Show when={customSymbolCount() > 0}>
              <span
                className={cn(
                  "text-[9px] font-medium tabular-nums",
                  customActive() ? "text-fin-primary" : "text-fin-text-muted",
                )}
              >
                {formatNumberIN(customSymbolCount())}
              </span>
            </Show>
          </button>
        </Box>

        <Show when={props.onPasteSymbols}>
          <Tooltip label="Paste a comma or newline separated symbol list">
            <button
              type="button"
              aria-label="Paste symbols"
              onClick={() => setPasteOpen(true)}
              data-testid="patterns-paste-symbols"
              className="inline-flex size-6 shrink-0 items-center justify-center rounded border border-fin-border bg-transparent text-fin-text-muted transition-colors hover:bg-fin-surface-alt hover:text-fin-text"
            >
              <IconClipboardText size={14} />
            </button>
          </Tooltip>
        </Show>

        <Box
          className="ml-auto flex min-w-0 shrink-0 flex-nowrap items-center justify-end gap-1.5"
        >
          <Box
            data-testid="patterns-job-status-wrap"
            data-visible={showStatus() ? "true" : "false"}
            className={cn("min-w-0", showStatus() ? "flex" : "hidden")}
          >
            <JobStatus job={props.job} queuePosition={props.queuePosition} scanning={props.scanning} />
          </Box>
          {props.scanActions}
          <button
            type="button"
            onClick={() => props.scan()}
            disabled={scanDisabled()}
            data-testid="patterns-scan-again"
            className="inline-flex h-6 min-w-[96px] items-center justify-center gap-1 whitespace-nowrap rounded-fin border-0 bg-fin-primary px-2 text-xs font-semibold text-fin-bg transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Show when={props.scanning} fallback={<IconPlayerPlay size={13} />}>
              <Spinner />
            </Show>
            {scanLabel()}
          </button>
        </Box>
      </Box>

      {props.actions}

      <Show when={props.error}>
        <Box
          role="alert"
          className="mt-1.5 flex items-center gap-1 rounded-fin border-l-[3px] border-fin-negative bg-fin-surface-alt px-1.5 py-[3px] text-fin-negative"
        >
          <IconAlertTriangle size={13} />
          <Text size="xs" c="error" data-testid="patterns-status-line">
            {props.error}
          </Text>
        </Box>
      </Show>

      <Show when={pasteOpen()}>
        <div
          data-testid="patterns-paste-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Paste symbols"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPasteOpen(false);
          }}
        >
          <div className="flex w-full max-w-md flex-col gap-2 rounded-fin border border-fin-border bg-fin-surface p-3 shadow-2xl">
            <div className="flex items-center justify-between">
              <Text size="sm" fw={600}>
                Paste symbols
              </Text>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setPasteOpen(false)}
                className="inline-flex size-6 items-center justify-center rounded text-fin-text-muted hover:bg-fin-surface-alt"
              >
                <IconX size={14} />
              </button>
            </div>
            <Text size="xs" c="dimmed">
              Comma, space or newline separated. Duplicates are removed.
            </Text>
            <Textarea
              value={pasteText()}
              onChange={setPasteText}
              placeholder="ASIANPAINT, CIPLA, LT, NTPC…"
              minRows={5}
              autosize
              autofocus
              data-testid="patterns-paste-symbols-input"
            />
            <Box className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPasteOpen(false)}
                className="inline-flex h-6 items-center rounded-fin px-2 text-xs text-fin-text transition-colors hover:bg-fin-surface-alt"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyPaste}
                disabled={parsed().length === 0}
                data-testid="patterns-paste-symbols-apply"
                className="inline-flex h-6 items-center rounded-fin bg-fin-primary px-2 text-xs font-semibold text-fin-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Use {parsed().length || ""} symbol{parsed().length === 1 ? "" : "s"}
              </button>
            </Box>
          </div>
        </div>
      </Show>
    </Box>
  );
}
