import { Suspense, lazy, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Center, Loader } from "@/ui";
import { fetchTimeframes } from "@/api/chartPatterns";
import type { TFSpec } from "@/types/chartPatterns";
import { usePatternFullscreen } from "@/hooks/usePatternFullscreen";
import { PatternFullscreenView } from "@/components/patterns/PatternFullscreenView";

const DailyReportPage = lazy(() => import("./DailyReportPage"));

/** Minimal timeframe ladder when the registry fetch fails. */
const FALLBACK_TIMEFRAMES: TFSpec[] = [{ id: "1D", label: "1D" } as TFSpec];

/**
 * Thin route entry for `/report` — lazy-loads the daily report page and
 * hosts the shared fullscreen pattern chart, so a symbol click opens the
 * identical fullscreen used on the Patterns screen.
 */
export function ReportContainer() {
  const [searchParams] = useSearchParams();
  const universe = searchParams.get("universe") ?? "nifty500";
  const [timeframes, setTimeframes] = useState<TFSpec[]>(FALLBACK_TIMEFRAMES);
  const {
    fullscreen,
    openFromSymbol,
    changeFullscreenTimeframe,
    changeFullscreenAsOf,
    selectFullscreenHit,
    closeFullscreen,
  } = usePatternFullscreen({ timeframe: "1D" });

  useEffect(() => {
    let active = true;
    fetchTimeframes()
      .then((list) => {
        if (active && list.length > 0) setTimeframes(list);
      })
      .catch(() => {
        /* non-fatal: keep the 1D fallback */
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <Suspense
      fallback={
        <Center>
          <Loader />
        </Center>
      }
    >
      <DailyReportPage universe={universe} onOpenSymbol={openFromSymbol} />
      <PatternFullscreenView
        opened={!!fullscreen}
        onClose={closeFullscreen}
        hit={fullscreen?.hit ?? null}
        hits={fullscreen?.hits ?? []}
        onSelectHit={selectFullscreenHit}
        candles={fullscreen?.candles ?? []}
        overlays={[]}
        trendLines={fullscreen?.trendLines ?? []}
        timeframe={fullscreen?.timeframe}
        timeframes={timeframes}
        onTimeframeChange={changeFullscreenTimeframe}
        loading={fullscreen?.loading ?? false}
        asOf={fullscreen?.asOf ?? null}
        fromDate={fullscreen?.fromDate ?? null}
        onAsOfChange={changeFullscreenAsOf}
      />
    </Suspense>
  );
}
