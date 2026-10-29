/**
 * Intraday P&L attribution for open NIFTY option legs.
 *
 * Pure helpers only (no React). Each leg's premium change
 * (`current − entry`, signed by direction × qty) is split into:
 *   - delta: Δspot × delta (entry delta when known, else the live greek)
 *   - vega:  ΔIV × vega (0 when either IV endpoint is missing)
 *   - theta: theta × elapsed days (0 when theta/elapsed is missing)
 *   - residual: total − (delta + vega + theta)
 *
 * Position/greek types are local on purpose — other agents own the
 * canonical option types, and this module must not import their files.
 */

type NiftyPnlOpt = "CE" | "PE";
type NiftyPnlDirection = "long" | "short";

/** One open leg. Everything numeric tolerates null/undefined (→ 0). */
export interface NiftyPnlPosition {
  opt: NiftyPnlOpt;
  strike: number;
  direction: NiftyPnlDirection;
  entry_premium: number;
  qty: number;
  entry_spot: number;
  entry_iv?: number | null;
  entry_delta?: number | null;
  /** Days since entry; defaults to `defaultElapsedDays` (else 0). */
  elapsed_days?: number | null;
}

/** Live greeks for one strike-leg, matched by opt + strike. */
export interface NiftyPnlGreeks {
  opt: NiftyPnlOpt;
  strike: number;
  ltp?: number | null;
  delta?: number | null;
  theta?: number | null;
  vega?: number | null;
  iv?: number | null;
}

interface NiftyLegAttribution {
  key: string;
  label: string;
  delta: number;
  vega: number;
  theta: number;
  residual: number;
  total: number;
  /** Live premium, or null when the leg has no greek snapshot. */
  current: number | null;
  /** True when no greek snapshot matched this leg (all parts 0). */
  missingGreeks: boolean;
}

export interface NiftyPnlAttribution {
  legs: NiftyLegAttribution[];
  total: number;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Attribute every leg. A leg with no matching greek snapshot keeps
 * `missingGreeks: true` with all parts (and the total) at 0 — it must
 * never invent a move. A leg WITH a snapshot but partial greeks still
 * computes the total; unknown parts stay 0 and the residual absorbs them.
 */
export function attributeNiftyPnl(
  positions: NiftyPnlPosition[] | null | undefined,
  greeks: NiftyPnlGreeks[] | null | undefined,
  spot: number | null | undefined,
  opts: { defaultElapsedDays?: number } = {},
): NiftyPnlAttribution {
  const legs: NiftyLegAttribution[] = [];
  const list = Array.isArray(positions) ? positions : [];
  const greekList = Array.isArray(greeks) ? greeks : [];
  const spotNow = num(spot);
  const defaultElapsed = num(opts.defaultElapsedDays) ?? 0;

  for (const pos of list) {
    if (!pos || !Number.isFinite(Number(pos.strike))) continue;
    const key = `${pos.strike}-${pos.opt}-${pos.direction}`;
    const label = `${Number(pos.strike).toLocaleString("en-IN")} ${pos.opt} ${pos.direction}`;
    const blank: NiftyLegAttribution = {
      key,
      label,
      delta: 0,
      vega: 0,
      theta: 0,
      residual: 0,
      total: 0,
      current: null,
      missingGreeks: true,
    };
    const g = greekList.find(
      (x) => x && x.opt === pos.opt && Number(x.strike) === Number(pos.strike),
    );
    if (!g) {
      legs.push(blank);
      continue;
    }
    const dirSign = pos.direction === "short" ? -1 : 1;
    const qty = num(pos.qty) ?? 0;
    const scale = dirSign * qty;
    const entryPremium = num(pos.entry_premium) ?? 0;
    const current = num(g.ltp);

    // Delta: Δspot × entry delta (else the live greek). No spot, no delta P&L.
    const deltaGreek = num(pos.entry_delta) ?? num(g.delta) ?? 0;
    const entrySpot = num(pos.entry_spot);
    const delta =
      spotNow !== null && entrySpot !== null ? (spotNow - entrySpot) * deltaGreek * scale : 0;

    // Vega: ΔIV × vega. Either IV endpoint missing → 0 (never guess a vol move).
    const entryIv = num(pos.entry_iv);
    const nowIv = num(g.iv);
    const vegaGreek = num(g.vega) ?? 0;
    const vega = entryIv !== null && nowIv !== null ? (nowIv - entryIv) * vegaGreek * scale : 0;

    // Theta: theta × elapsed days (decay accrues even without a spot move).
    const thetaGreek = num(g.theta) ?? 0;
    const elapsed = num(pos.elapsed_days) ?? defaultElapsed;
    const theta = thetaGreek * elapsed * scale;

    const total = current !== null ? (current - entryPremium) * scale : 0;
    const residual = total - (delta + vega + theta);

    legs.push({ key, label, delta, vega, theta, residual, total, current, missingGreeks: false });
  }

  return { legs, total: legs.reduce((a, l) => a + l.total, 0) };
}

/** Signed ₹ with Indian grouping and 0 dp (`+2,500` / `−120` / `0`). */
export function formatPnlSigned(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const rounded = Math.round(v);
  if (rounded === 0) return "0";
  const sign = rounded > 0 ? "+" : "−";
  return `${sign}${Math.abs(rounded).toLocaleString("en-IN")}`;
}
