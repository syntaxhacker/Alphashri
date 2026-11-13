import { createMemo, For } from "solid-js";
import { SimpleGrid, useMediaQuery } from "@/ui";
import type { PatternHitDTO, TrendlinesView } from "@/types/chartPatterns";
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
export function PatternGrid(props: PatternGridProps) {
  const isWide = useMediaQuery("(min-width: 1400px)");
  const isDesktop = useMediaQuery("(min-width: 1200px)");
  const isTablet = useMediaQuery("(min-width: 900px)");
  const cols = createMemo(() => (isWide() ? 4 : isDesktop() ? 3 : isTablet() ? 2 : 1));

  const trendlinesView = () => props.trendlinesView ?? "both";
  const activeHit = () => props.activeHit ?? null;

  /**
   * Identity of the docked hit, resolved once per active change instead of
   * rebuilding a dedupe key per card (200 string allocations per render).
   * Field equality matches `fullscreenDedupeKey` without the join.
   */
  const isActive = (hit: PatternHitDTO): boolean => {
    const active = activeHit();
    if (!active) return false;
    return (
      active.symbol === hit.symbol &&
      active.timeframe === hit.timeframe &&
      active.pattern_id === hit.pattern_id &&
      active.start_date === hit.start_date &&
      active.end_date === hit.end_date
    );
  };

  return (
    <SimpleGrid cols={cols()} spacing={16} data-testid="patterns-grid">
      <For each={props.hits}>
        {(hit) => (
          <PatternCard
            hit={hit}
            selected={isActive(hit)}
            onClick={props.onSelect}
            onExpand={props.onExpand}
            onShowMembers={props.onShowMembers}
            trendlinesView={trendlinesView()}
            onSymbolPreview={props.onSymbolPreview}
            onSymbolPreviewEnd={props.onSymbolPreviewEnd}
            onSymbolOpen={props.onSymbolOpen}
          />
        )}
      </For>
    </SimpleGrid>
  );
}
