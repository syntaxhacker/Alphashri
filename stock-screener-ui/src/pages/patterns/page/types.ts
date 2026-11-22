import type {
  JobDTO,
  PatternDef,
  PatternFilters,
  PatternHitDTO,
  PatternSummary,
  TFSpec,
  Universe,
} from "@/types/chartPatterns";
import type { IndexGroup } from "@/config/indexGroups";
import type { ReplayScanArgs } from "@/components/patterns/ReplayScanControl";

export type ViewMode = "matrix" | "list" | "grid";

export interface PatternsPageProps {
  timeframes: TFSpec[];
  universes: Universe[];
  patterns: PatternDef[];
  timeframe: string;
  setTimeframe: (value: string) => void;
  selectedTimeframes?: string[];
  setSelectedTimeframes?: (value: string[]) => void;
  lookbackBars: number | null;
  setLookbackBars: (value: number | null) => void;
  universe: string;
  setUniverse: (value: string) => void;
  filters: PatternFilters;
  setFilter: (key: string, value: any) => void;
  resetFilters: () => void;
  applyFilters: (filters: Partial<PatternFilters>) => void;
  computeTrendlines: boolean;
  setComputeTrendlines: (value: boolean) => void;
  customUniverse: string;
  selectSymbols: (symbols: string[]) => void;
  job: JobDTO | null;
  scanning: boolean;
  queuePosition: number | null;
  summary: PatternSummary | null;
  results: PatternHitDTO[];
  total: number;
  streaming?: boolean;
  loading: boolean;
  error: string | null;
  scan: () => void;
  refresh: () => void;
  /** Clear cached candles for the scope + timeframe and re-scan fresh. */
  forceRefresh: () => void;
  scanReplay?: (args: ReplayScanArgs) => void;
  replayAsOf?: string | null;
  tab?: "scan" | "watch";
  setTab?: (tab: "scan" | "watch") => void;
  defaultView?: ViewMode;
  view?: ViewMode;
  setView?: (view: ViewMode) => void;
  indexGroup?: IndexGroup;
  setIndexGroup?: (group: IndexGroup) => void;
  members?: string | null;
  setMembers?: (indexId: string | null) => void;
}
