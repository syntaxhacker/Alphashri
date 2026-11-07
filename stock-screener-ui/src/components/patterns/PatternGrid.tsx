import { SimpleGrid, useMediaQuery } from "@/ui";
import type { PatternHitDTO, TrendlinesView } from "@/types/chartPatterns";
import { fullscreenDedupeKey } from "@/hooks/usePatternFullscreen";
import { PatternCard } from "./PatternCard";

export interface PatternGridProps {
  hits: PatternHitDTO[];
  onSelect: (hit: PatternHitDTO) => void;
  onExpand?: (hit: PatternHitDTO) => void;
  onShowMembers?: (symbol: string) => void;
  /** View-only filter for standalone support/resistance lines. */
  trendlinesView?: TrendlinesView;
  /** Hit currently shown in the docked chart — outlined in the grid. */
  activeHit?: PatternHitDTO | null;
  /** Hover intent for the right-side symbol preview (host debounces). */
  onSymbolPreview?: (symbol: string) => void;
  onSymbolPreviewEnd?: (symbol: string) => void;
  /** Chart icon: open the symbol in the right-side chart. */
  onSymbolOpen?: (symbol: string) => void;
}

/** Responsive card grid of pattern hits (4-up on wide desktop). */
export function PatternGrid({
  hits,
  onSelect,
  onExpand,
  onShowMembers,
  trendlinesView = "both",
  activeHit = null,
  onSymbolPreview,
  onSymbolPreviewEnd,
  onSymbolOpen,
}: PatternGridProps) {
  const isWide = useMediaQuery("(min-width: 1400px)");
  const isDesktop = useMediaQuery("(min-width: 1200px)");
  const isTablet = useMediaQuery("(min-width: 900px)");
  const cols = isWide ? 4 : isDesktop ? 3 : isTablet ? 2 : 1;

  return (
    <SimpleGrid cols={cols} spacing={16} data-testid="patterns-grid">
      {hits.map((hit) => (
        <PatternCard
          key={hit.id ?? `${hit.symbol}-${hit.pattern_id}-${hit.timeframe}-${hit.start_date}`}
          hit={hit}
          selected={
            activeHit ? fullscreenDedupeKey(activeHit) === fullscreenDedupeKey(hit) : false
          }
          onClick={onSelect}
          onExpand={onExpand}
          onShowMembers={onShowMembers}
          trendlinesView={trendlinesView}
          onSymbolPreview={onSymbolPreview}
          onSymbolPreviewEnd={onSymbolPreviewEnd}
          onSymbolOpen={onSymbolOpen}
        />
      ))}
    </SimpleGrid>
  );
}
