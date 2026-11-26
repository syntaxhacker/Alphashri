import { useMediaQuery } from "@/ui";

/**
 * Patterns switches to the single-column result list below this width. The
 * dense table needs ~720px before Score / Pos% / Patterns stop being clipped,
 * so the cutoff sits below the usual tablet breakpoint rather than at md.
 */
export const PATTERNS_NARROW_QUERY = "(max-width: 899px)";

export function usePatternsNarrow(): () => boolean {
  return useMediaQuery(PATTERNS_NARROW_QUERY, false);
}
