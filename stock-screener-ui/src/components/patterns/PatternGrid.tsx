import { SimpleGrid, useMediaQuery } from "@/ui";
import type { PatternHitDTO, TrendlinesView } from "@/types/chartPatterns";
import { PatternCard } from "./PatternCard";

export interface PatternGridProps {
  hits: PatternHitDTO[];
  onSelect: (hit: PatternHitDTO) => void;
  onExpand?: (hit: PatternHitDTO) => void;
  /** View-only filter for standalone support/resistance lines. */
  trendlinesView?: TrendlinesView;
}

/** Responsive card grid of pattern hits. */
export function PatternGrid({ hits, onSelect, onExpand, trendlinesView = "both" }: PatternGridProps) {
  const isDesktop = useMediaQuery("(min-width: 1200px)");
  const isTablet = useMediaQuery("(min-width: 900px)");
  const cols = isDesktop ? 3 : isTablet ? 2 : 1;

  return (
    <SimpleGrid cols={cols} spacing={16} data-testid="patterns-grid">
      {hits.map((hit) => (
        <PatternCard
          key={hit.id ?? `${hit.symbol}-${hit.pattern_id}-${hit.timeframe}-${hit.start_date}`}
          hit={hit}
          onClick={onSelect}
          onExpand={onExpand}
          trendlinesView={trendlinesView}
        />
      ))}
    </SimpleGrid>
  );
}
