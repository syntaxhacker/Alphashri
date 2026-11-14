import { createSignal, onCleanup } from "solid-js";
import { copyToClipboard, toCsv, toSymbolList, type CsvColumn } from "@/utils/copyCsv";

/** How long the "Copied N rows" toast stays on screen. */
export const COPY_FEEDBACK_MS = 3000;

export interface CopyFeedback {
  copyMsg: () => string | null;
  copyFailed: () => boolean;
  /** Copy rows as CSV using the given column map. */
  copyRows: (rows: readonly unknown[], columns: readonly CsvColumn[]) => Promise<void>;
  /** Copy one symbol per line. */
  copySymbols: (rows: readonly unknown[]) => Promise<void>;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Transient clipboard feedback shared by the scanner and watch views: both
 * show the same "Copied N rows/symbols" toast and clear it after a timeout.
 *
 * `copyMsg`/`copyFailed` are accessors — read them as `copyMsg()` in JSX.
 */
export function useCopyFeedback(resetMs: number = COPY_FEEDBACK_MS): CopyFeedback {
  const [copyMsg, setCopyMsg] = createSignal<string | null>(null);
  const [copyFailed, setCopyFailed] = createSignal(false);
  let timer: number | null = null;

  onCleanup(() => {
    if (timer != null) window.clearTimeout(timer);
  });

  const flash = (message: string, failed: boolean) => {
    setCopyMsg(message);
    setCopyFailed(failed);
    if (timer != null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      setCopyMsg(null);
      setCopyFailed(false);
      timer = null;
    }, resetMs);
  };

  const copy = async (text: string, successMessage: string) => {
    const ok = await copyToClipboard(text);
    flash(ok ? successMessage : "Copy failed", !ok);
  };

  const copyRows = async (rows: readonly unknown[], columns: readonly CsvColumn[]) => {
    const csv = toCsv(rows as Array<Record<string, unknown>>, [...columns]);
    await copy(csv, `Copied ${plural(rows.length, "row")}`);
  };

  const copySymbols = async (rows: readonly unknown[]) => {
    const list = toSymbolList(rows as Array<Record<string, unknown>>);
    await copy(list, `Copied ${plural(rows.length, "symbol")}`);
  };

  return { copyMsg, copyFailed, copyRows, copySymbols };
}