import { formatNumberIN } from "@/utils/ui-helpers";
import type { MarketAlert } from "@/components/notifications/MarketAlertCard";
import { FUEL_STATE_LABEL } from "./niftyOiBursts.types";
import type { OiBurst, OiSignal } from "./niftyOiBursts.types";
import { burstTimeLabel, burstTs, compact, levelText, shortNum } from "./niftyOiBursts.format";
import { isNonTradeAlertType, isWallEventType } from "./niftyOiBursts.normalize";
import { coveringDirection, isSpentFuel, resolveFuelState } from "./niftyOiBursts.signal";
import type { OiEntryFreshness } from "./niftyOiBursts.types";

/** Zero and non-finite deltas are absent readings, not one-minute OI moves. */
function hasRealOiMove(v: number | null | undefined): boolean {
  return typeof v === "number" && Number.isFinite(v) && v !== 0;
}

const spotMetric = (burst: OiBurst) =>
  Number.isFinite(burst.spot) && burst.spot > 0
    ? [{ label: "SPOT", value: formatNumberIN(Math.round(burst.spot)) }]
    : [];

/** Unknown geometry is an em dash with no `%` suffix — a missing reading must
 *  never be rendered as if it were a measured percentage. */
function pctOrDash(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(3)}%` : "—";
}

const FUEL_PLAIN: Record<string, string> = {
  writers_covering: "shorts covering", longs_liquidating: "longs exiting",
  fresh_buyers: "buyers adding", fresh_sellers: "writers adding",
};
const FUEL_WHY: Record<string, string> = {
  writers_covering: "shorts buying back lifts the index", longs_liquidating: "longs exiting presses the index",
  fresh_buyers: "fresh buying supports the index", fresh_sellers: "fresh selling caps the index",
};

/** Wall test/rejection/break → alert. Icons carry the event class (◇ / ✕ / ↑↓);
 *  all rows join the oi_burst trail and the severity rail supplies the colour. */
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
  const title = `${icon} ${sideCode} ${levelTxt} ${!isTest && targetTxt ? `→ ${targetTxt}` : verb}`;

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
    ...spotMetric(burst),
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

/** A relocation is a `from` → `to` state change with no OI delta — never route
 *  it through the burst grammar, which would invent a fake `ΔOI +0`. */
function wallRelocationToAlert(burst: OiBurst): MarketAlert {
  const side = burst.side === "put" ? "PUT" : "CALL";
  const fromTxt = levelText(burst.from ?? burst.wall ?? null) || "?";
  const toTxt = levelText(burst.to ?? burst.strike ?? null) || "?";
  const detail = [
    burst.detail?.trim() || `${side.toLowerCase()} wall moved ${fromTxt} → ${toTxt}`,
    burst.flip ? "side flip — the wall changed sides" : null,
    "No OI burst — this is a wall state change.",
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" · ");

  return {
    id: burst.id,
    kind: "oi_burst",
    severity: burst.severity,
    symbol: "NIFTY",
    title: `${side} WALL ${fromTxt} → ${toTxt}${burst.flip ? " · SIDE FLIP" : ""}`,
    detail,
    metrics: [
      { label: "FROM", value: fromTxt },
      { label: "TO", value: toTxt },
      ...spotMetric(burst),
      ...(typeof burst.migration_strikes === "number" && Number.isFinite(burst.migration_strikes)
        ? [{ label: "STEPS", value: String(burst.migration_strikes) }]
        : []),
    ],
    ts: burstTs(burst.t),
    source: `Nifty walls · ${burstTimeLabel(burst.t)} IST · relocation`,
    href: "/report/index",
    actionable: false,
  } as MarketAlert;
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
      ...spotMetric(burst),
    ],
    ts: burstTs(burst.t),
    source: "Nifty tape watchdog",
    href: "/report/index",
  };
}

/** Withheld plan → evidence, never an instruction. Premium/spot are the only
 *  readings that can back a leg; an OI delta alone is not a direction. */
function unconfirmedToAlert(burst: OiBurst): MarketAlert {
  const sideLabel = burst.side === "call" ? "Call" : "Put";
  const c = burst.confirmation ?? null;
  const doi = hasRealOiMove(burst.delta) ? compact(burst.delta) : null;
  const spotTxt = formatNumberIN(Math.round(burst.spot));
  const signed = (v: number) => `${v > 0 ? "+" : ""}${v}`;

  const evidence = [
    c?.same_strike === true ? "same-strike premium and OI agree" : null,
    c?.same_strike === false ? "no same-strike agreement" : null,
    c && Number.isFinite(c.strike_oi_delta) ? `strike OI ${compact(c.strike_oi_delta!)}` : null,
    c && Number.isFinite(c.strike_premium_change) ? `strike premium ${signed(c.strike_premium_change!)}` : null,
    c && Number.isFinite(c.spot_change) ? `spot ${signed(c.spot_change!)} pts` : null,
    c?.reasons?.length ? c.reasons.join("; ") : null,
  ].filter((p): p is string => typeof p === "string" && p.length > 0);

  const detail = [
    doi
      ? `${sideLabel} OI ${doi} in 1 min @ ${spotTxt}.`
      : `${sideLabel} OI shift @ ${spotTxt} — no one-minute OI move to size.`,
    evidence.length > 0
      ? `Evidence: ${evidence.join(" · ")}.`
      : "Direction not confirmed — same-strike premium and spot evidence are missing.",
    "No trade. Heuristic, not advice.",
  ].join(" ");

  const tone: "up" | "down" = (burst.delta ?? 0) >= 0 ? "up" : "down";
  const metrics = [
    ...(doi ? [{ label: "ΔOI", value: doi, tone }] : []),
    { label: "SPOT", value: spotTxt },
    ...(c?.same_strike != null ? [{ label: "SAME STRIKE", value: c.same_strike ? "yes" : "no" }] : []),
    ...(c && Number.isFinite(c.strike_oi_delta) ? [{ label: "STRIKE ΔOI", value: compact(c.strike_oi_delta!) }] : []),
    ...(c && Number.isFinite(c.strike_premium_change) ? [{ label: "STRIKE Δ₹", value: signed(c.strike_premium_change!) }] : []),
    ...(c && Number.isFinite(c.spot_change) ? [{ label: "SPOT Δ", value: signed(c.spot_change!) }] : []),
    ...(c?.reasons?.length ? [{ label: "REASON", value: c.reasons[0] }] : []),
  ];

  return {
    id: burst.id,
    kind: "oi_burst",
    severity: burst.severity,
    symbol: "NIFTY",
    title: "OI SHIFT · unconfirmed",
    detail,
    metrics,
    ts: burstTs(burst.t),
    source: `Nifty tape · ${burstTimeLabel(burst.t)} IST · unconfirmed`,
    href: "/report/index",
    actionable: false,
  } as MarketAlert;
}

/** Burst → alert: WHAT (fuel) · WHERE (level) · WITH (reason) · GUARD. Spent fuel
 *  without a break is "NO TRADE"; a stale entry is "RE-PRICE" — neither takes
 *  the sticky banner (actionable=false). */
export function burstToAlert(
  burst: OiBurst,
  signal?: OiSignal | null,
  opts: { freshness?: OiEntryFreshness | null } = {},
): MarketAlert {
  // Wall geometry, relocations, coils and system warnings bypass the
  // OI-burst grammar entirely: they carry no one-minute OI move to rate.
  if (isWallEventType(burst.type)) return wallEventToAlert(burst);
  if (burst.type === "wall") return wallRelocationToAlert(burst);
  if (burst.type === "data_stale") return dataStaleToAlert(burst);
  // The backend withheld the plan or could not confirm a leg at the same
  // strike. Even a supplied signal is dropped: no direction from OI alone.
  // Non-trade rows keep their own renderer instead of borrowing this label.
  if (
    !isNonTradeAlertType(burst.type) &&
    (burst.plan_suppressed === true || burst.flow === "unconfirmed")
  ) {
    return unconfirmedToAlert(burst);
  }

  const sideLabel = burst.side === "call" ? "Call" : "Put";
  const tone: "up" | "down" = (burst.delta ?? 0) >= 0 ? "up" : "down";
  const scoreTxt = `${burst.score.toFixed(1)}× a normal minute`;

  // WHAT: fresh money, or a book being spent. Plain English, not "fuel" jargon.
  const fuel = resolveFuelState(burst);
  const spent = isSpentFuel(fuel);
  // Coils, wall geometry and system warnings carry no one-minute OI move: even
  // a backend-supplied fuel state must not surface as a FUEL metric on them.
  const showFuel = !!fuel && !isNonTradeAlertType(burst.type);
  const plainFuel =
    (fuel && FUEL_PLAIN[fuel]) || ((burst.delta ?? 0) >= 0 ? "writers adding" : "shorts covering");
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
  if (burst.setup === "short_squeeze" && !signal) {
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
        ...(showFuel ? [{ label: "FUEL", value: spent ? "spent" : "fresh" }] : []),
      ]
    : [
        ...setupMetrics,
        ...(hasRealOiMove(burst.delta)
          ? [
              { label: "ΔOI", value: compact(burst.delta), tone },
              { label: "CUM", value: compact(burst.cumDoi), tone: (burst.cumDoi ?? 0) >= 0 ? ("up" as const) : ("down" as const) },
              { label: "TICK", value: compact(burst.tickVol) },
            ]
          : []),
        { label: "SPOT", value: burst.spot.toLocaleString("en-IN", { maximumFractionDigits: 0 }) },
        ...(showFuel ? [{ label: "FUEL", value: spent ? "spent" : "fresh" }] : []),
      ];

  // Verdict: spent fuel with no break in this direction is not a trade.
  // A backend-withheld plan returns earlier, before any plan is considered.
  const suppressed =
    fuel === "writers_covering" &&
    structure !== null &&
    structure.direction !== coveringDirection(burst.side);

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
      : (fuel && FUEL_WHY[fuel]) || "flow shifted";
  const doTxt = late
    ? `wait for a 1-min close ${dirWord} ${levelTxt} before buying`
    : signal
      ? `buy ${signal.leg} ${formatNumberIN(signal.strike)} — entry ${signal.entry}, stop ${signal.sl}, target ${signal.target}`
      : "no trade — wait for a level break";

  const detail =
    burst.type === "coil"
      ? `spot ${formatNumberIN(burst.spot)} pressed on the ${burst.side} wall ${
          typeof burst.wall === "number" ? formatNumberIN(burst.wall) : "?"
        } · ${pctOrDash(burst.range_pct)} range, ${pctOrDash(burst.dist_pct)} away · heads-up, no plan`
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
  // Wall geometry/relocations, coils and stale-data warnings describe a state
  // change, not an OI move: the alert itself is the whole banner.
  if (burst && isNonTradeAlertType(burst.type)) return alert.title;
  // The backend withheld the plan or could not confirm a same-strike/spot leg.
  // Neither fuel nor the supplied alert may re-introduce a direction here: an
  // OI delta alone is not a buyer/writer claim and never carries a plan.
  if (burst && (burst.plan_suppressed === true || burst.flow === "unconfirmed")) {
    const doi = hasRealOiMove(burst.delta) ? compact(burst.delta) : null;
    const spotTxt =
      Number.isFinite(burst.spot) && burst.spot > 0
        ? formatNumberIN(Math.round(burst.spot))
        : "";
    const evidence = [doi ? `ΔOI ${doi}` : "", spotTxt ? `spot ${spotTxt}` : ""]
      .filter((p) => p.length > 0)
      .join(" · ");
    return `OI SHIFT · unconfirmed — spot/premium did not confirm${
      evidence ? ` · ${evidence}` : ""
    }`;
  }
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
        fuel ? plain[fuel] : (burst.delta ?? 0) >= 0 ? "BUILD" : "UNWIND"
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
