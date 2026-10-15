import { apiGet } from "./utils";

/** One stored order-flow journal file, as listed for the replay picker. */
export interface JournalFile {
  file: string;
  day: string;
  symbol: string;
  broker: string;
  bytes: number;
  modified: number;
}

interface JournalFilesResponse {
  files: JournalFile[];
  count: number;
}

/** Stored journal files, newest day first. Read-only; opens no socket. */
export async function listJournalFiles(days = 30): Promise<JournalFile[]> {
  const res = await apiGet<JournalFilesResponse>(
    `/api/orderflow/journal/files?days=${encodeURIComponent(String(days))}`,
  );
  return res.files ?? [];
}
