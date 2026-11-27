import { CHANGE_WINDOWS, DAY_MS } from "./constants";
import { addDays, dayNumber, finite } from "./shared";
import type {
  AgriEdaComparePoint,
  AgriEdaCompareSeries,
  ChangeAnchor,
  ChangeMatrix,
  ChangeMatrixOptions,
  ChangeWindow,
  GroupPulseRow,
} from "./types";

function emptyAnchor(window: ChangeWindow, toleranceDays: number): ChangeAnchor {
  return {
    window,
    targetDate: null,
    toleranceDays,
    date: null,
    daysFromTarget: null,
    withinTolerance: false,
    modal: null,
    changePct: null,
  };
}

/**
 * 1W / 1M / 3M / 6M percent change from the latest observation. Each anchor is
 * the latest date at or before the target and must sit inside the window's
 * tolerance; otherwise that cell is null rather than reporting a gap-spanning
 * move as if it were the nominal window.
 */
export function changeMatrix(
  series: AgriEdaComparePoint[] | null | undefined,
  options: ChangeMatrixOptions = {},
): ChangeMatrix {
  const key = typeof options.key === "string" ? options.key : "";
  const label = typeof options.label === "string" ? options.label : key;

  const byDate = new Map<string, { day: number; date: string; modal: number }>();
  for (const point of Array.isArray(series) ? series : []) {
    const date = point?.date;
    if (typeof date !== "string") continue;
    const day = dayNumber(date);
    const modal = finite(point?.modal);
    if (day == null || modal == null) continue;
    // Duplicate dates keep the last finite modal, matching the lag alignment.
    byDate.set(date, { day, date, modal });
  }
  const observations = [...byDate.values()].sort((a, b) => a.day - b.day);
  const current = observations[observations.length - 1] ?? null;

  const changes = {} as Record<ChangeWindow, number | null>;
  const anchors = {} as Record<ChangeWindow, ChangeAnchor>;
  for (const window of CHANGE_WINDOWS) {
    changes[window.key] = null;
    anchors[window.key] = emptyAnchor(window.key, window.toleranceDays);
    if (!current) continue;

    const targetDate = addDays(current.date, -window.days);
    const targetDay = dayNumber(targetDate);
    if (targetDay == null) continue;
    anchors[window.key].targetDate = targetDate;

    let anchor: { day: number; date: string; modal: number } | null = null;
    for (let i = observations.length - 1; i >= 0; i--) {
      if (observations[i].day <= targetDay) {
        anchor = observations[i];
        break;
      }
    }
    if (!anchor) continue;

    const daysFromTarget = (anchor.day - targetDay) / DAY_MS;
    anchors[window.key].date = anchor.date;
    anchors[window.key].modal = anchor.modal;
    anchors[window.key].daysFromTarget = daysFromTarget;
    anchors[window.key].withinTolerance = Math.abs(daysFromTarget) <= window.toleranceDays;
    if (!anchors[window.key].withinTolerance || anchor.modal === 0) continue;

    const changePct = ((current.modal - anchor.modal) / anchor.modal) * 100;
    anchors[window.key].changePct = finite(changePct);
    changes[window.key] = anchors[window.key].changePct;
  }

  return {
    key,
    label,
    asOf: current?.date ?? null,
    modal: current?.modal ?? null,
    n: observations.length,
    changes,
    anchors,
  };
}

/** Fluctuation-matrix rows: one gap-guarded change row per comparison series. */
export function groupPulse(seriesByKey: AgriEdaCompareSeries[] | null | undefined): GroupPulseRow[] {
  const source = Array.isArray(seriesByKey) ? seriesByKey : [];
  const rows: GroupPulseRow[] = [];
  for (const entry of source) {
    if (!entry || typeof entry.key !== "string") continue;
    const points = Array.isArray(entry.points) ? entry.points : [];
    rows.push(
      changeMatrix(points, {
        key: entry.key,
        label: typeof entry.label === "string" ? entry.label : entry.key,
      }),
    );
  }
  return rows;
}
