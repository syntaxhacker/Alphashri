import { describe, expect, it } from "vitest";
import {
  SURGE_BADGE_CAP,
  SURGE_LABEL_CAP,
  countTodaySurges,
  resolveTodayCount,
  surgeAriaLabel,
  surgeBadgeText,
  surgeTooltip,
} from "./surgeAlertCount";
import type { PriceSurgeEvent } from "../../types/notifications";
import type { SurgeListResponse } from "../../api/notifications";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istIso(hour: number, dayOffset = 0): string {
  const base = new Date(Date.now() + IST_OFFSET_MS);
  const utcWall = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + dayOffset, hour);
  return new Date(utcWall - IST_OFFSET_MS).toISOString();
}

function event(id: number, created_at: string): PriceSurgeEvent {
  return {
    id,
    symbol: "TEST",
    move_pct: 2,
    direction: "up",
    price: 100,
    screener_id: "s",
    screen_label: "L",
    created_at,
  };
}

describe("countTodaySurges", () => {
  it("counts only events stamped in the current IST session", () => {
    const events = [
      event(1, istIso(9)),
      event(2, istIso(14)),
      event(3, istIso(9, -1)),
      event(4, istIso(9, -30)),
      event(5, "not-a-date"),
    ];
    expect(countTodaySurges(events)).toBe(2);
  });

  it("returns zero for an empty page", () => {
    expect(countTodaySurges([])).toBe(0);
  });
});

describe("resolveTodayCount", () => {
  it("prefers the backend today_count over the all-time total", () => {
    const data: SurgeListResponse = { total: 7094, today_count: 3, events: [] };
    expect(resolveTodayCount(data)).toBe(3);
  });

  it("falls back to counting today's rows when the backend omits today_count", () => {
    const data: SurgeListResponse = {
      total: 7094,
      events: [event(1, istIso(10)), event(2, istIso(11)), event(3, istIso(10, -1))],
    };
    expect(resolveTodayCount(data)).toBe(2);
  });

  it("does not treat an invalid today_count as a real value", () => {
    const data = { total: 7094, today_count: Number.NaN, events: [] } as unknown as SurgeListResponse;
    expect(resolveTodayCount(data)).toBe(0);
  });
});

describe("bell badge and labels", () => {
  it(`caps the badge at ${SURGE_BADGE_CAP}+`, () => {
    expect(surgeBadgeText(0)).toBeNull();
    expect(surgeBadgeText(-1)).toBeNull();
    expect(surgeBadgeText(3)).toBe("3");
    expect(surgeBadgeText(9)).toBe("9");
    expect(surgeBadgeText(10)).toBe("9+");
    expect(surgeBadgeText(7094)).toBe("9+");
  });

  it("names the bounded quantity in the aria-label instead of the all-time total", () => {
    expect(surgeAriaLabel(3)).toBe("Notifications, 3 unread today");
    expect(surgeAriaLabel(7094)).toBe(`Notifications, ${SURGE_LABEL_CAP}+ unread today`);
    expect(surgeAriaLabel(7094)).not.toContain("7094");
  });

  it("uses 'Notifications' for the empty state", () => {
    expect(surgeAriaLabel(0)).toBe("Notifications");
    expect(surgeTooltip(0)).toBe("Notifications");
    expect(surgeBadgeText(0)).toBeNull();
  });

  it("keeps tooltip and aria-label in agreement", () => {
    for (const n of [1, 3, 9, 10, 7094]) {
      expect(surgeTooltip(n)).toBe(surgeAriaLabel(n).replace("Notifications, ", ""));
    }
  });
});
