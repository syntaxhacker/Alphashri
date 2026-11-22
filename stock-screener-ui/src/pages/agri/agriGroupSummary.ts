import { AGRI_GROUPS } from "@/config/agri";
import type { AgriGroupKey, AgriSnapshot } from "@/types/agri";
import type { AgriGroupSummary } from "./AgriGroupOverview";

type ChangeField = "chg_6m_pct" | "chg_1m_pct";

const finite = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * One horizon for the whole overview. A 1M move and a 6M move are different
 * measurements, so averaging or ranking them into one index would be a made-up
 * number. Prefer 6M; use 1M only when the group has no 6M observation at all.
 */
export function groupChangeField(rows: readonly AgriSnapshot[]): ChangeField | null {
  if (rows.some((row) => finite(row.chg_6m_pct) != null)) return "chg_6m_pct";
  if (rows.some((row) => finite(row.chg_1m_pct) != null)) return "chg_1m_pct";
  return null;
}

export function buildAgriGroupSummaries(
  snapshot: readonly AgriSnapshot[],
  groups: readonly { key: AgriGroupKey }[] = AGRI_GROUPS,
): AgriGroupSummary[] {
  return groups.map((group) => {
    const rows = snapshot.filter((row) => row.group === group.key && row.date);
    const field = groupChangeField(rows);
    const changes = field
      ? rows
          .map((row) => finite(row[field]))
          .filter((value): value is number => value != null)
          .sort((a, b) => a - b)
      : [];
    const median = changes.length > 0 ? changes[Math.floor((changes.length - 1) / 2)] : null;
    const up = changes.filter((value) => value > 0).length;
    const ranked = field
      ? rows
          .filter((row) => finite(row[field]) != null)
          .sort((a, b) => (finite(b[field]) as number) - (finite(a[field]) as number))
      : [];
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];

    return {
      key: group.key,
      index: median == null ? null : 100 + median,
      index_chg_pct: median,
      up_count: up,
      total_count: changes.length,
      breadth_pct: changes.length > 0 ? (up / changes.length) * 100 : null,
      best: best && field ? { key: best.key, label: best.label, chg_pct: finite(best[field]) } : null,
      worst: worst && field ? { key: worst.key, label: worst.label, chg_pct: finite(worst[field]) } : null,
      mandis: rows.reduce((sum, row) => sum + (finite(row.markets) ?? 0), 0),
      as_of: rows.reduce<string | null>(
        (latest, row) => (!latest || row.date > latest ? row.date : latest),
        null,
      ),
    };
  });
}
