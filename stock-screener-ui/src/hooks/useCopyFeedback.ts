import { useCallback, useEffect, useRef, useState } from "react";
import { copyToClipboard, toCsv, toSymbolList, type CsvColumn } from "@/utils/copyCsv";

/** How long the "Copied N rows" toast stays on screen. */
export const COPY_FEEDBACK_MS = 3000;

export interface CopyFeedback {
  copyMsg: string | null;
  copyFailed: boolean;
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
 */
export function useCopyFeedback(resetMs: number = COPY_FEEDBACK_MS): CopyFeedback {
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const flash = useCallback(
    (message: string, failed: boolean) => {
      setCopyMsg(message);
      setCopyFailed(failed);
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        setCopyMsg(null);
        setCopyFailed(false);
        timerRef.current = null;
      }, resetMs);
    },
    [resetMs],
  );

  const copy = useCallback(
    async (text: string, successMessage: string) => {
      const ok = await copyToClipboard(text);
      flash(ok ? successMessage : "Copy failed", !ok);
    },
    [flash],
  );

  const copyRows = useCallback(
    async (rows: readonly unknown[], columns: readonly CsvColumn[]) => {
      const csv = toCsv(rows as Array<Record<string, unknown>>, [...columns]);
      await copy(csv, `Copied ${plural(rows.length, "row")}`);
    },
    [copy],
  );

  const copySymbols = useCallback(
    async (rows: readonly unknown[]) => {
      const list = toSymbolList(rows as Array<Record<string, unknown>>);
      await copy(list, `Copied ${plural(rows.length, "symbol")}`);
    },
    [copy],
  );

  return { copyMsg, copyFailed, copyRows, copySymbols };
}
