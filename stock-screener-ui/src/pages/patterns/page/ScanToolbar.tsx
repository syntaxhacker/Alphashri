import type { JSX } from "solid-js";
import { Box } from "@/ui";
import type { JobDTO, Universe } from "@/types/chartPatterns";
import { UniverseBar } from "@/components/patterns/UniverseBar";
import { ScanCacheChip } from "@/components/patterns/ScanProgress";

export interface ScanToolbarProps {
  universes: () => Universe[];
  universe: () => string;
  setUniverse: (value: string) => void;
  customUniverse: () => string;
  customSymbolCount: () => number;
  selectSymbols: (symbols: string[]) => void;
  scan: () => void;
  scanning: () => boolean;
  job: () => JobDTO | null;
  queuePosition: () => number | null;
  error: () => string | null;
  forceRefresh: () => void;
  showCacheChip: () => boolean;
  actions: JSX.Element;
}

/** Scan-scope band from UniverseBar plus its cache action and tool slot. */
export function ScanToolbar(props: ScanToolbarProps) {
  return (
    <UniverseBar
      universes={props.universes()}
      universe={props.universe()}
      setUniverse={props.setUniverse}
      customUniverse={props.customUniverse()}
      customSymbolCount={props.customSymbolCount()}
      onPasteSymbols={props.selectSymbols}
      scan={props.scan}
      scanning={props.scanning()}
      job={props.job()}
      queuePosition={props.queuePosition()}
      error={props.error()}
      scanActions={
        props.showCacheChip() ? (
          <Box className="flex min-w-0 items-center gap-1">
            <ScanCacheChip job={props.job()} onForceRefresh={props.forceRefresh} />
            {/* The scan-session date is already shown by JobStatus
                ("Last scan complete · through …"); the stat strip owns the
                last-candle timestamp. No third duplicate stamp here. */}
          </Box>
        ) : null
      }
      actions={props.actions}
    />
  );
}
