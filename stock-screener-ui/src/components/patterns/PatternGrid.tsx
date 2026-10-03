import { SimpleGrid, useMediaQuery } from "@/ui";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { PatternCard } from "./PatternCard";

export interface PatternGridProps {
  hits: PatternHitDTO[];
  selectedSymbol: string | null;
  onSelect: (hit: PatternHitDTO) => void;
  onExpand?: (hit: PatternHitDTO) => void;
}

/** Responsive card grid of pattern hits. */
export function PatternGrid({ hits, selectedSymbol, onSelect, onExpand }: PatternGridProps) {
  const isDesktop = useMediaQuery("(min-width: 1200px)");
  const isTablet = useMediaQuery("(min-width: 900px)");
  const cols = isDesktop ? 3 : isTablet ? 2 : 1;

  return (
    <SimpleGrid cols={cols} spacing={16} data-testid="patterns-grid">
      {hits.map((hit) => (
        <PatternCard
          key={`${hit.symbol}-${hit.pattern_id}-${hit.timeframe}`}
          hit={hit}
          selected={selectedSymbol === hit.symbol}
          onClick={onSelect}
          onExpand={onExpand}
        />
      ))}
    </SimpleGrid>
  );
}
