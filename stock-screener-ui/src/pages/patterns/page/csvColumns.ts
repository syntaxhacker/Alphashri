import type { CsvColumn } from "@/utils/copyCsv";

export const PATTERNS_CSV_COLUMNS: CsvColumn[] = [
  { key: "symbol", header: "Symbol" },
  { key: "pattern_id", header: "Pattern ID" },
  { key: "pattern_name", header: "Pattern" },
  { key: "family", header: "Family" },
  { key: "direction", header: "Direction" },
  { key: "status", header: "Status" },
  { key: "quality", header: "Quality" },
  { key: "confidence", header: "Confidence" },
  { key: "timeframe", header: "Timeframe" },
  { key: "start_date", header: "Start" },
  { key: "end_date", header: "End" },
  { key: "breakout_level", header: "Breakout" },
  { key: "target", header: "Target" },
  { key: "stop", header: "Stop" },
  { key: "rr", header: "R:R" },
  { key: "volume_confirmed", header: "Vol confirmed" },
  { key: "bars_ago", header: "Bars ago" },
];
