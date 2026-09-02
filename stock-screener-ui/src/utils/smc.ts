// SMC Fair Value Gap (FVG) + Inverted FVG (iFVG) — pure utils, no UI deps
// Definition: 3-bar pattern [i-2, i-1, i]
//   Bull FVG: low[i] > high[i-2] => gap [high[i-2], low[i]]
//   Bear FVG: high[i] < low[i-2] => gap [high[i], low[i-2]]  (top = low[i-2], bottom = high[i])
// iFVG: prior FVG violated by CLOSE beyond opposite edge (wick alone does not invert).

export type Bar = {
  time: number; // unix seconds (lightweight-charts compatible)
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type FvgZone = {
  type: "bull" | "bear";
  top: number;
  bottom: number;
  leftTime: number;
  rightTime: number;
  leftIdx: number;
  rightIdx: number;
  midIdx: number;
  mitigated: boolean;
};

export type IfvgZone = {
  type: "bull" | "bear"; // inverted direction
  top: number;
  bottom: number;
  leftTime: number;
  rightTime: number;
  invertTime: number;
  invertIdx: number;
  origFvg: FvgZone;
};

export function detectFVG(bars: Bar[] | null | undefined): FvgZone[] {
  if (!Array.isArray(bars) || bars.length < 3) return [];
  const out: FvgZone[] = [];
  for (let i = 2; i < bars.length; i++) {
    const a = bars[i - 2];
    const c = bars[i];
    if (!a || !c || !bars[i - 1]) continue;
    const isBull = c.low > a.high;
    const isBear = c.high < a.low;
    if (!isBull && !isBear) continue;
    const top = isBull ? c.low : a.low;
    const bottom = isBull ? a.high : c.high;
    // mitigation: any close after formation inside [bottom, top]
    let mitigated = false;
    for (let j = i + 1; j < bars.length; j++) {
      const cl = bars[j].close;
      if (cl >= bottom && cl <= top) {
        mitigated = true;
        break;
      }
    }
    out.push({
      type: isBull ? "bull" : "bear",
      top,
      bottom,
      leftTime: a.time,
      rightTime: c.time,
      leftIdx: i - 2,
      rightIdx: i,
      midIdx: i - 1,
      mitigated,
    });
  }
  return out;
}

export function detectIFVG(
  bars: Bar[] | null | undefined,
  fvgs: FvgZone[] | null | undefined,
): IfvgZone[] {
  if (!Array.isArray(bars) || !Array.isArray(fvgs) || bars.length === 0 || fvgs.length === 0) return [];
  const out: IfvgZone[] = [];
  for (const f of fvgs) {
    // scan after f.rightIdx
    const start = f.rightIdx + 1;
    if (start >= bars.length) continue;
    for (let j = start; j < bars.length; j++) {
      const cl = bars[j]?.close;
      if (cl == null) continue;
      let inverted = false;
      let invType: "bull" | "bear" = "bull";
      if (f.type === "bull" && cl < f.bottom) {
        inverted = true;
        invType = "bear";
      } else if (f.type === "bear" && cl > f.top) {
        inverted = true;
        invType = "bull";
      }
      if (inverted) {
        out.push({
          type: invType,
          top: f.top,
          bottom: f.bottom,
          leftTime: f.leftTime,
          rightTime: f.rightTime,
          invertTime: bars[j].time,
          invertIdx: j,
          origFvg: f,
        });
        break; // only first inversion per FVG
      }
    }
  }
  return out;
}
