import { For } from "solid-js";
import { Badge, Box, Text } from "@/ui";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { formatChartPrice } from "./chartFormat";
import { formatMatrixPct, formatRangePos, formatScore, hitChangePct } from "./patternFormat";
import { changeTextTone } from "./patternTone";
import { directionGlyph, directionTone } from "./symbolMatrix";

export interface PatternNarrowResultsProps {
  hits: PatternHitDTO[];
  onSelect: (hit: PatternHitDTO) => void;
}

const BADGE_TONE = { success: "success", error: "error", dimmed: "default" } as const;

/**
 * Phone-sized result list. One row carries the whole answer — symbol, the
 * pattern found, fit score, range position and the day's move — so the result
 * never has to be recovered by scrolling a dense table sideways.
 */
export function PatternNarrowResults(props: PatternNarrowResultsProps) {
  return (
    <Box
      data-testid="patterns-narrow-results"
      role="region"
      aria-label="Pattern results"
      class="min-h-0 min-w-0 flex-1 overflow-y-auto pr-0.5"
    >
      <For each={props.hits}>
        {(hit) => {
          const suffix = () => `${hit.symbol}-${hit.pattern_id}${hit.id != null ? `-${hit.id}` : ""}`;
          return (
            <Box
              data-testid={`patterns-narrow-result-${suffix()}`}
              role="button"
              tabIndex={0}
              aria-label={`Open ${hit.symbol} ${hit.pattern_name} chart`}
              onClick={() => props.onSelect(hit)}
              onKeyDown={(event: KeyboardEvent) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                props.onSelect(hit);
              }}
              class="mb-1 cursor-pointer rounded-fin border border-fin-border bg-fin-surface px-2 py-1 transition-colors hover:border-fin-primary focus-visible:outline-2 focus-visible:outline-fin-primary"
            >
              <Box class="flex min-w-0 items-center gap-1.5">
                <Text size="xs" fw={700} class="shrink-0 font-mono tabular-nums">
                  {hit.symbol}
                </Text>
                <span title={String(hit.direction ?? "")} aria-label={String(hit.direction ?? "")} class="text-ui-micro font-bold text-fin-text-muted">
                  {directionGlyph(hit.direction)}
                </span>
                <Badge
                  data-testid={`patterns-narrow-pattern-${suffix()}`}
                  size="xs"
                  variant="light"
                  color={BADGE_TONE[directionTone(hit.direction)]}
                  title={`${hit.pattern_name} · ${String(hit.timeframe ?? "")} · ${String(hit.status ?? "")}`}
                  className="min-w-0 truncate border-0"
                >
                  {hit.pattern_name}
                </Badge>
                <Text
                  data-testid={`patterns-narrow-chg-${suffix()}`}
                  size="xs"
                  fw={600}
                  c={changeTextTone(hitChangePct(hit))}
                  title="Day change %"
                  class="ml-auto shrink-0 font-mono tabular-nums"
                >
                  {formatMatrixPct(hitChangePct(hit))}
                </Text>
              </Box>
              <Box class="mt-0.5 flex min-w-0 items-baseline gap-3">
                <Text size="xs" c="dimmed" class="shrink-0 text-ui-micro uppercase">
                  Score
                </Text>
                <Text
                  data-testid={`patterns-narrow-score-${suffix()}`}
                  size="xs"
                  fw={600}
                  title="Pattern-fit confidence (geometry fit, R², volume) — not breakout conviction."
                  class="font-mono tabular-nums"
                >
                  {formatScore(hit.confidence)}
                </Text>
                <Text size="xs" c="dimmed" class="shrink-0 text-ui-micro uppercase">
                  Pos %
                </Text>
                <Text
                  data-testid={`patterns-narrow-pos-${suffix()}`}
                  size="xs"
                  fw={600}
                  title="Position within the pattern's price range, 0% at the low and 100% at the high."
                  class="font-mono tabular-nums"
                >
                  {formatRangePos(hit.range_pos)}
                </Text>
                <Text size="xs" c="dimmed" class="ml-auto shrink-0 font-mono tabular-nums">
                  {formatChartPrice(hit.last_close ?? hit.end_price)}
                </Text>
              </Box>
            </Box>
          );
        }}
      </For>
    </Box>
  );
}
