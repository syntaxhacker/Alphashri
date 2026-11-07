import * as palette from "@/ui/palette";

/** Minimal structural shape of a wall burst from `/api/reports/nifty/bursts`. */
export interface WallBurstLike {
  type?: string | null;
  kind?: string | null;
  t?: string | null;
  side?: string | null;
  strike?: number | null;
  target?: number | null;
  spot?: number | null;
  label?: string | null;
}

export interface WallOverlayLine {
  yAxis: number;
  label: { formatter: string };
  lineStyle: { type: "solid" | "dashed"; color: string };
  includeInScale: boolean;
}

export interface WallOverlayMarker {
  time: string;
  value: number;
  shape?: "circle" | "arrowUp" | "arrowDown";
  color?: string;
  position?: "aboveBar" | "belowBar";
  text?: string;
}

const WALL_TYPES = new Set(["wall_test", "rejection", "break", "wall_break"]);

/**
 * Map wall bursts to chart annotations.
 *
 * The 2026-11-03 case is the reference: a dashed line at 23,700 (tested
 * 11:54) plus a marker on the 12:10 rejection and a dashed target line at
 * max pain 23,650. Watch tests are muted; rejection/break markers are the
 * actual events; only one line per level survives.
 */
export function wallEventOverlay(bursts: WallBurstLike[] | null | undefined): {
  markLines: WallOverlayLine[];
  markers: WallOverlayMarker[];
} {
  const markLines: WallOverlayLine[] = [];
  const markers: WallOverlayMarker[] = [];
  const seenLevels = new Set<number>();
  for (const burst of bursts ?? []) {
    const type = burst.type ?? burst.kind ?? "";
    if (!WALL_TYPES.has(type)) continue;
    if (burst.strike == null) continue;
    const level = Number(burst.strike);
    if (!Number.isFinite(level)) continue;
    const side = (burst.side ?? "call").toLowerCase() === "put" ? "PUT" : "CALL";

    if (!seenLevels.has(level)) {
      seenLevels.add(level);
      markLines.push({
        yAxis: level,
        label: { formatter: `${side} WALL ${Math.round(level).toLocaleString("en-IN")}` },
        lineStyle: {
          type: "dashed",
          color: type === "wall_test" ? palette.TEXT_MUTED : palette.WARNING,
        },
        includeInScale: false,
      });
    }

    if (type === "rejection" && burst.target != null && Number.isFinite(Number(burst.target))) {
      const target = Number(burst.target);
      if (!seenLevels.has(target)) {
        seenLevels.add(target);
        markLines.push({
          yAxis: target,
          label: { formatter: `TARGET ${Math.round(target).toLocaleString("en-IN")}` },
          lineStyle: { type: "dashed", color: palette.NEGATIVE },
          includeInScale: false,
        });
      }
    }

    if (type !== "wall_test") {
      const value = burst.spot != null ? Number(burst.spot) : level;
      if (Number.isFinite(value) && burst.t) {
        const isBreak = type === "break";
        const clock = String(burst.t).slice(11, 16);
        const tag = side === "CALL" ? "CW" : "PW";
        markers.push({
          time: burst.t,
          value,
          shape: isBreak ? "arrowUp" : "arrowDown",
          color: isBreak ? palette.POSITIVE : palette.NEGATIVE,
          // Separate a level that both rejected and broke: rejection above
          // the bar, break below it, so the two never sit on top of each other.
          position: type === "rejection" ? "aboveBar" : "belowBar",
          text: isBreak ? `↑ ${tag} ${clock}` : type === "rejection" ? `✕ ${tag} ${clock}` : `↓ ${tag} ${clock}`,
        });
      }
    }
  }
  return { markLines, markers };
}
