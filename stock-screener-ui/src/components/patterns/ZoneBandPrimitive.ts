import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";
import { withAlpha } from "@/utils/color";
import type { TVRect } from "./patternTVData";

interface MediaCoordinateSpace {
  context: CanvasRenderingContext2D;
  mediaSize: { width: number; height: number };
}

/** Structural slice of `CanvasRenderingTarget2D` (avoids the transitive dep). */
interface RenderingTarget {
  useMediaCoordinateSpace<T>(fn: (scope: MediaCoordinateSpace) => T): T;
}

export const ZONE_FILL_ALPHA = 0.08;
export const ZONE_BORDER_ALPHA = 0.7;
export const ZONE_BORDER_DASH: readonly number[] = [3, 3];

/**
 * Draws S/R bands behind every series via a `drawBackground` renderer attached
 * to the candle series. Coordinates are clipped to the pane; a band never
 * extends past its own end time or the right edge of the plot.
 */
export class ZoneBandPrimitive implements ISeriesPrimitive<Time> {
  private zones: readonly TVRect[];
  private attachedParams: SeriesAttachedParameter<Time> | null = null;
  private readonly renderer: IPrimitivePaneRenderer = {
    // The band belongs behind every series, so only the background pass paints.
    draw: () => {},
    drawBackground: (target: RenderingTarget) => this.draw(target),
  };
  private readonly paneView: IPrimitivePaneView = {
    zOrder: (): PrimitivePaneViewZOrder => "bottom",
    renderer: () => this.renderer,
  };

  constructor(zones: readonly TVRect[] = []) {
    this.zones = zones;
  }

  setZones(zones: readonly TVRect[]): void {
    this.zones = zones;
    this.attachedParams?.requestUpdate();
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.attachedParams = param;
  }

  detached(): void {
    this.attachedParams = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.paneView];
  }

  private draw(target: RenderingTarget): void {
    const param = this.attachedParams;
    if (!param || this.zones.length === 0) return;
    const timeScale = param.chart.timeScale();
    const series = param.series;

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const width = mediaSize.width;
      const height = mediaSize.height;
      if (!(width > 0 && height > 0)) return;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
      ctx.clip();

      for (const zone of this.zones) {
        const startX = timeScale.timeToCoordinate(zone.start as Time);
        const endX = timeScale.timeToCoordinate(zone.end as Time);
        const topY = series.priceToCoordinate(zone.top);
        const bottomY = series.priceToCoordinate(zone.bottom);
        if (startX == null || endX == null || topY == null || bottomY == null) continue;

        let x0 = Math.min(startX, endX);
        let x1 = Math.max(startX, endX);
        let y0 = Math.min(topY, bottomY);
        let y1 = Math.max(topY, bottomY);
        if (x1 < 0 || x0 >= width || y1 < 0 || y0 >= height) continue;

        x0 = Math.max(0, x0);
        x1 = Math.min(width, x1);
        y0 = Math.max(0, y0);
        y1 = Math.min(height, y1);
        if (x1 < x0 || y1 <= y0) continue;
        // A one-bar band still needs a visible sliver.
        if (x1 - x0 < 1) x1 = Math.min(width, x0 + 1);

        ctx.fillStyle = withAlpha(zone.color, ZONE_FILL_ALPHA);
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        ctx.strokeStyle = withAlpha(zone.color, ZONE_BORDER_ALPHA);
        ctx.lineWidth = 1;
        ctx.setLineDash([...ZONE_BORDER_DASH]);
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, Math.max(0, x1 - x0 - 1), Math.max(0, y1 - y0 - 1));
      }

      ctx.restore();
    });
  }
}
