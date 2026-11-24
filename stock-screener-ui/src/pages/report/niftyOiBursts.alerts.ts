import { formatNumberIN } from "@/utils/ui-helpers";
import type { MarketAlert } from "@/components/notifications/MarketAlertCard";
import { FUEL_STATE_LABEL } from "./niftyOiBursts.types";
import type { OiBurst, OiSignal } from "./niftyOiBursts.types";
import { burstTimeLabel, burstTs, compact, levelText, shortNum } from "./niftyOiBursts.format";
import { isWallEventType } from "./niftyOiBursts.normalize";
import { coveringDirection, isSpentFuel, resolveFuelState } from "./niftyOiBursts.signal";
import type { OiEntryFreshness } from "./niftyOiBursts.types";

/**
 * Strike-wall event → alert.
 *
 * Icons carry the event class so the row reads at a glance:
 *   ◇ wall_test  (watch — the wall is being tested, no break yet)
 *   ✕ rejection  (alert — the wall held; target = the move's magnet)
 *   ↑ / ↓ break  (alert — the wall broke; arrow follows the side)
 *
 * All wall events are `kind: "oi_burst"` so they join the existing trail/toast
 * pipeline; the severity rail is what colours them (watch = muted,
 * rejection/break = warning).
 */
function wallEventToAlert(burst: OiBurst): MarketAlert {
  const type = burst.type ?? "wall_test";
  const level = burst.strike ?? burst.wall ?? null;
  const target = burst.target ?? null;
  const sideCode = burst.side === "put" ? "PW" : "CW";
  const levelTxt = levelText(level);
  const targetTxt = levelText(target);
  const isTest = type === "wall_test";
  const isBreak = type === "break" || type === "wall_break";
  const icon = isTest ? "◇" : type === "rejection" ? "✕" : burst.side === "put" ? "↓" : "↑";
  const verb = isTest ? "TESTED" : type === "rejection" ? "REJECTED" : "BROKEN";
  const title = isTest
    ? `${icon} ${sideCode} ${levelTxt} ${verb}`
    : targetTxt
      ? `${icon} ${sideCode} ${levelTxt} → ${targetTxt}`
      : `${icon} ${sideCode} ${levelTxt} ${verb}`;

  const fallback = isTest
    ? `${sideCode} ${levelTxt} is being tested · no break yet`
    : type === "rejection"
      ? `${sideCode} ${levelTxt} held${targetTxt ? ` · magnet ${targetTxt}` : ""}`
      : `${sideCode} ${levelTxt} broke${targetTxt ? ` · next ${targetTxt}` : ""}`;
  const detail = [burst.detail?.trim(), burst.label?.trim(), fallback]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .filter((part, i, all) => all.indexOf(part) === i)
    .join(" · ");

  const metrics = [
    ...(levelTxt ? [{ label: isBreak ? "BROKE" : "STRIKE", value: levelTxt }] : []),
    ...(targetTxt ? [{ label: "TGT", value: targetTxt, tone: "down" as const }] : []),
    ...(Number.isFinite(burst.spot) && burst.spot > 0
      ? [{ label: "SPOT", value: formatNumberIN(Math.round(burst.spot)) }]
      : []),
  ];

  return {
    id: burst.id,
    kind: "oi_burst",
    severity: isTest ? "watch" : "alert",
    symbol: "NIFTY",
    title,
    detail,
    metrics,
    ts: burstTs(burst.t),
    source: `Nifty walls · ${burstTimeLabel(burst.t)} IST`,
    href: "/report/index",
  };
}

/** Backend `data_stale` warning → critical system alert. */
function dataStaleToAlert(burst: OiBurst): MarketAlert {
  const since = burst.t ? ` since ${burstTimeLabel(burst.t)} IST` : "";
  const title = burst.label?.trim() || "DATA STALE";
  const detail =
    burst.detail?.trim() ||
    `The tape stopped updating${since}. Treat prices and OI as indicative until it resumes.`;
  return {
    id: burst.id,
    kind: "system",
    severity: "critical",
    symbol: "NIFTY",
    title,
    detail,
    metrics: [
      ...(burst.t ? [{ label: "TAPE", value: `${burstTimeLabel(burst.t)} IST` }] : []),
      ...(Number.isFinite(burst.spot) && burst.spot > 0
        ? [{ label: "SPOT", value: formatNumberIN(Math.round(burst.spot)) }]
        : []),
    ],
    ts: burstTs(burst.t),
    source: "Nifty tape watchdog",
    href: "/report/index",
  };
}

/**
 * Burst → alert. Grammar: WHAT (fuel) · WHERE (level) · WITH (reason) ·
 * GUARD (invalidation). A spent-fuel burst without a structure break prints
 * "NO TRADE"; a plan whose entry the market has run away from prints
 * "RE-PRICE". Both are actionable=false, so they never take the banner.
 */
export function burstToAlert(
  burst: OiBurst,
  signal?: OiSignal | null,
  opts: { freshness?: OiEntryFreshness | null } = {},
): MarketAlert {
  // Wall geometry and system warnings bypass the OI-burst grammar entirely.
  if (isWallEventType(burst.type)) return wallEventToAlert(burst);
  if (burst.type === "data_stale") return dataStaleToAlert(burst);

  const sideLabel = burst.side === "call" ? "Call" : "Put";
  const tone: "up" | "down" = burst.delta >= 0 ? "up" : "down";
  const scoreTxt = `${burst.score.toFixed(1)}× a normal minute`;

  // WHAT: fresh money, or a book being spent. Plain English, not "fuel" jargon.
  const fuel = resolveFuelState(burst);
  const spent = isSpentFuel(fuel);
  const plainFuel =
    fuel === "writers_covering"
      ? "shorts covering"
      : fuel === "longs_liquidating"
        ? "longs exiting"
        : fuel === "fresh_buyers"
          ? "buyers adding"
          : fuel === "fresh_sellers"
            ? "writers adding"
            : burst.delta >= 0
              ? "writers adding"
              : "shorts covering";
  const what = `${sideLabel} ${plainFuel} ${compact(burst.delta)}`;

  // WHERE: the level the underlying closed beyond.
  const structure = burst.structure ?? null;
  const where = structure
    ? `@ ${formatNumberIN(Math.round(burst.spot))} (${
        structure.direction === "up" ? "above" : "below"
      } the ${formatNumberIN(structure.level)} ${structure.kind ?? "level"})`
    : `@ ${formatNumberIN(Math.round(burst.spot))}`;

  const setupMetrics = burst.setup_label
    ? [
        { label: "SETUP", value: burst.setup_label },
        ...(burst.horizon ? [{ label: "MODE", value: burst.horizon.toUpperCase() }] : []),
        ...(burst.trigger != null ? [{ label: "TRIGGER", value: formatNumberIN(burst.trigger) }] : []),
      ]
    : [];

  // A covering burst at/near a call wall is a *scalp watch*, not the usual
  // "no trade" suppressed plan: spot was still below the wall at detection
  // (e.g. 24,995 vs 25,000 on 2026-11-09 11:35:58) and the break happens
  // seconds later. Surface the playbook without pretending it is a swing plan.
  if (burst.setup === "short_squeeze" && (!signal || burst.plan_suppressed === true)) {
    const trig = burst.trigger != null ? formatNumberIN(burst.trigger) : "the wall";
    return {
      id: burst.id,
      kind: "oi_burst",
      severity: burst.severity,
      symbol: "NIFTY",
      title: `SHORT SQUEEZE · scalp · wait for ${trig}`,
      detail: `${what} ${where}. ${
        burst.playbook ?? "Wait for a 1-min close through the wall; exit if the OI rebuilds."
      } ${scoreTxt}. Heuristic, not advice.`,
      metrics: [
        ...setupMetrics,
        { label: "ΔOI", value: compact(burst.delta), tone },
        { label: "SPOT", value: burst.spot.toLocaleString("en-IN", { maximumFractionDigits: 0 }) },
      ],
      ts: Date.parse(burst.t) || Date.now(),
      source: `Nifty tape · ${burstTimeLabel(burst.t)} IST · setup watch`,
      href: "/report/index",
      actionable: false,
    } as MarketAlert;
  }
  // The level the plan needs before it is a trade, and the "already spent" flag.
  const level = structure?.level ?? signal?.strike ?? null;
  const levelTxt = level != null ? formatNumberIN(level) : "";
  const dirWord = structure?.direction === "up" ? "above" : "below";
  const late = spent && !structure && !!signal;

  // GUARD: the level that invalidates the idea.
  const invalidation =
    burst.invalidation ??
    (structure && structure.direction === "down" ? structure.level : null);
  const guardTxt =
    invalidation !== null
      ? `while spot stays ${structure?.direction === "down" ? "below" : "above"} ${formatNumberIN(invalidation)}`
      : "";

  const freshness = opts.freshness ?? null;
  const stale = freshness?.stale === true;
  const staleTxt =
    stale && freshness?.live != null && signal
      ? `entry ${signal.entry.toFixed(2)} vs live ${freshness.live.toFixed(2)} (${
          freshness.driftPct! > 0 ? "+" : ""
        }${freshness.driftPct!.toFixed(1)}%)`
      : "";

  const metrics = signal
    ? [
        ...setupMetrics,
        { label: "ENTRY", value: signal.entry.toFixed(2) },
        ...(freshness?.live != null
          ? [{ label: "LIVE", value: freshness.live.toFixed(2) }]
          : []),
        { label: "SL", value: signal.sl.toFixed(2), tone: "down" as const },
        { label: "TGT", value: signal.target.toFixed(2), tone: "up" as const },
        { label: "QTY", value: signal.qty > 0 ? String(signal.qty) : "—" },
        { label: "ΔOI", value: compact(burst.delta), tone },
        ...(fuel ? [{ label: "FUEL", value: spent ? "spent" : "fresh" }] : []),
      ]
    : [
        ...setupMetrics,
        { label: "ΔOI", value: compact(burst.delta), tone },
        { label: "CUM", value: compact(burst.cumDoi), tone: burst.cumDoi >= 0 ? ("up" as const) : ("down" as const) },
        { label: "TICK", value: compact(burst.tickVol) },
        { label: "SPOT", value: burst.spot.toLocaleString("en-IN", { maximumFractionDigits: 0 }) },
        ...(fuel ? [{ label: "FUEL", value: spent ? "spent" : "fresh" }] : []),
      ];

  // Verdict: the backend withheld the plan, or spent fuel has no break in
  // this direction — either way it is not a trade.
  const suppressed =
    burst.plan_suppressed === true ||
    (fuel === "writers_covering" &&
      structure !== null &&
      structure.direction !== coveringDirection(burst.side));

  // WHY there is no trade: spent fuel without a break, or the backend's own
  // filter (trend / structure) withholding the plan.
  const noTradeWhy =
    fuel && isSpentFuel(fuel)
      ? `${FUEL_STATE_LABEL[fuel].toLowerCase()} — ${
          structure ? "no level closed in this direction" : "no structure break"
        }`
      : "plan withheld by the trend/structure filter";

  const setupPrefix =
    burst.setup === "wall_squeeze"
      ? "WALL SQUEEZE · "
      : burst.setup === "fresh_long"
        ? "FRESH BUY · "
        : "";
  const baseTitle = stale && signal
    ? `RE-PRICE · BUY ${signal.leg} ${formatNumberIN(signal.strike)} · ${staleTxt}`
    : suppressed
      ? `NO TRADE · ${noTradeWhy}`
      : signal
        ? late
          ? `BUY ${signal.leg} ${formatNumberIN(signal.strike)} only after the ${levelTxt} break`
          : `→ BUY ${signal.leg} ${formatNumberIN(signal.strike)} · qty ${signal.qty > 0 ? signal.qty : "—"}`
        : burst.type === "coil"
          ? `COILING @ ${typeof burst.wall === "number" ? formatNumberIN(burst.wall) : "wall"}`
          : `${sideLabel} OI burst ${compact(burst.delta)} in 1 min`;
  const title = setupPrefix && !baseTitle.startsWith("NO TRADE") ? `${setupPrefix}${baseTitle}` : baseTitle;

  const whyTxt =
    burst.type === "squeeze"
      ? "short-covering squeeze through a wall"
      : fuel === "writers_covering"
      ? "shorts buying back lifts the index"
      : fuel === "longs_liquidating"
        ? "longs exiting presses the index"
        : fuel === "fresh_buyers"
          ? "fresh buying supports the index"
          : fuel === "fresh_sellers"
            ? "fresh selling caps the index"
            : "flow shifted";
  const doTxt = late
    ? `wait for a 1-min close ${dirWord} ${levelTxt} before buying`
    : signal
      ? `buy ${signal.leg} ${formatNumberIN(signal.strike)} — entry ${signal.entry}, stop ${signal.sl}, target ${signal.target}`
      : "no trade — wait for a level break";

  const detail =
    burst.type === "coil"
      ? `spot ${formatNumberIN(burst.spot)} pressed on the ${burst.side} wall ${
          typeof burst.wall === "number" ? formatNumberIN(burst.wall) : "?"
        } · ${burst.range_pct?.toFixed(3) ?? "?"}% range, ${burst.dist_pct?.toFixed(3) ?? "?"}% away · heads-up, no plan`
      : suppressed
        ? `${what} ${where}. ${noTradeWhy}. ${doTxt}. Not a trade.`
        : signal
          ? `${what} ${where}. ${whyTxt}. ${doTxt}.${guardTxt ? ` ${guardTxt}.` : ""}${
              staleTxt ? ` ${staleTxt} — re-price before trading.` : ""
            } ${scoreTxt}. Heuristic, not advice.`
          : `${what} ${where}. ${whyTxt}. ${doTxt}.${guardTxt ? ` ${guardTxt}.` : ""}${burst.playbook ? ` ${burst.playbook}` : ""} ${scoreTxt} · ${burstTimeLabel(burst.t)} IST`;

  // Candidate catalyst: lead with the headline nearest the burst.
  const headline = burst.news?.[0];
  const newsTxt = headline
    ? ` · NEWS ${headline.minutesAway >= 0 ? "+" : ""}${headline.minutesAway.toFixed(0)}m: ${headline.heading}`
    : "";

  return {
    id: burst.id,
    kind: "oi_burst",
    severity: burst.severity,
    symbol: "NIFTY",
    title,
    detail: `${detail}${newsTxt}`,
    metrics,
    ts: Date.parse(burst.t) || Date.now(),
    source: `Nifty tape · ${burstTimeLabel(burst.t)} IST${signal ? " · mechanical plan" : ""}${headline ? ` · ${headline.source || "news"}` : ""}`,
    href: "/report/index",
    // A suppressed or stale plan must not take the sticky banner.
    ...(suppressed || stale ? { actionable: false } : {}),
  } as MarketAlert;
}

export function criticalBannerText(
  burst: OiBurst | undefined,
  alert: MarketAlert,
): string {
  const doi =
    alert.metrics?.find((m) => m.label === "ΔOI")?.value ??
    (burst ? compact(burst.delta) : "");
  const fuel = burst ? resolveFuelState(burst) : null;
  const plain: Record<string, string> = {
    fresh_buyers: "BUYERS ADDING",
    fresh_sellers: "WRITERS ADDING",
    writers_covering: "SHORTS COVERING",
    longs_liquidating: "LONGS EXITING",
  };
  const head = burst
    ? `CRITICAL ${burst.side === "call" ? "CALL" : "PUT"} ${
        fuel ? plain[fuel] : burst.delta >= 0 ? "BUILD" : "UNWIND"
      } ${doi}`
    : "CRITICAL";
  const spotTxt =
    burst && Number.isFinite(burst.spot) && burst.spot > 0
      ? formatNumberIN(Math.round(burst.spot))
      : "";
  const entry = alert.metrics?.find((m) => m.label === "ENTRY")?.value;
  const sl = alert.metrics?.find((m) => m.label === "SL")?.value;
  const tgt = alert.metrics?.find((m) => m.label === "TGT")?.value;
  const plan =
    entry !== undefined && sl !== undefined && tgt !== undefined
      ? `${alert.title} · entry ${shortNum(entry)} · SL ${shortNum(sl)} · TGT ${shortNum(tgt)}`
      : alert.title;
  return [head, spotTxt, plan].filter((p) => p.length > 0).join(" · ");
}
