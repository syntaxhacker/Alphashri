import {
  currentIstDayKey,
  unreadSurgeCount,
  acknowledgeSurgeAlerts,
} from "../../state/store/notificationsSlice";
import type { SurgeListResponse } from "../../api/notifications";
import type { PriceSurgeEvent } from "../../types/notifications";

export const SURGE_BADGE_CAP = 9;
export const SURGE_LABEL_CAP = 99;

function dayKeyFromIso(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? "" : currentIstDayKey(ms);
}

/** Count only events stamped in the current IST session. */
export function countTodaySurges(events: PriceSurgeEvent[]): number {
  const today = currentIstDayKey();
  return events.reduce(
    (n, ev) => (ev?.created_at && dayKeyFromIso(ev.created_at) === today ? n + 1 : n),
    0,
  );
}

/**
 * Prefer the backend's bounded `today_count`. If an older backend omits it,
 * fall back to counting today's rows in the returned page — never the all-time
 * `total`, which is the source of the runaway badge.
 */
export function resolveTodayCount(data: SurgeListResponse): number {
  if (typeof data.today_count === "number" && Number.isFinite(data.today_count)) {
    return Math.max(0, Math.trunc(data.today_count));
  }
  return Array.isArray(data.events) ? countTodaySurges(data.events) : 0;
}

/** Unread count derived from today's total minus the user's acknowledgement. */
export function unreadFromResponse(data: SurgeListResponse): number {
  return unreadSurgeCount(resolveTodayCount(data));
}

/** Convenience for callers that fetch the panel page and want to mark it read. */
export function acknowledgeFromResponse(data: SurgeListResponse): void {
  acknowledgeSurgeAlerts(resolveTodayCount(data));
}

function countText(unread: number): string {
  const n = Math.trunc(unread);
  return n > SURGE_LABEL_CAP ? `${SURGE_LABEL_CAP}+` : String(n);
}

/** Badge is always capped at 9+ so a busy day cannot deform the icon. */
export function surgeBadgeText(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > SURGE_BADGE_CAP ? "9+" : String(Math.trunc(unread));
}

/** Spoken by screen readers. Deliberately says what is being counted. */
export function surgeAriaLabel(unread: number): string {
  if (unread <= 0) return "Notifications";
  return `Notifications, ${countText(unread)} unread today`;
}

/** Hover tooltip mirrors the aria-label so sighted and SR users agree. */
export function surgeTooltip(unread: number): string {
  if (unread <= 0) return "Notifications";
  return `${countText(unread)} unread today`;
}
