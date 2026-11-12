/**
 * Local Solid-native twins of src/components/screener/Sparkline.tsx and
 * SymbolAvatar.tsx — those files are still importing the broken @/ui Box and
 * cannot mount. Keeps the same props and data-* contracts (sparkline,
 * symbol-avatar, data-positive, data-points, data-fallback, data-symbol).
 */
import { createEffect, createSignal, Show } from "solid-js";
import { SCALE_BLUE, SCALE_CYAN, SCALE_GREEN, SCALE_ORANGE, SCALE_PINK, SCALE_VIOLET, TEXT } from "@/ui/palette";

const AVATAR_TINTS = [
  SCALE_BLUE[6],
  SCALE_GREEN[6],
  SCALE_VIOLET[5],
  SCALE_ORANGE[5],
  SCALE_CYAN[5],
  SCALE_PINK[5],
];

function initialsFor(symbol: string): string {
  const letters = (symbol || "").replace(/[^A-Za-z]/g, "").toUpperCase();
  if (letters.length >= 2) return letters.slice(0, 2);
  if (letters.length === 1) return letters;
  return (symbol || "?").slice(0, 2).toUpperCase() || "?";
}

function tintFor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i += 1) {
    hash = (hash * 31 + symbol.charCodeAt(i)) >>> 0;
  }
  return AVATAR_TINTS[hash % AVATAR_TINTS.length];
}

export function LocalSymbolAvatar(props: { symbol: string; name?: string; logo?: string | null; size?: number }) {
  const [failed, setFailed] = createSignal(false);

  createEffect(() => {
    void props.logo;
    void props.symbol;
    setFailed(false);
  });

  const showImg = () => props.logo != null && props.logo !== "" && !failed();
  const size = () => props.size ?? 20;

  return (
    <div
      data-testid="symbol-avatar"
      data-symbol={props.symbol}
      data-fallback={showImg() ? undefined : "initials"}
      title={props.name || props.symbol}
      class="inline-flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={{
        "width": `${size()}px`,
        "height": `${size()}px`,
        "min-width": `${size()}px`,
        "min-height": `${size()}px`,
        "background-color": showImg() ? "var(--color-fin-surface-alt)" : tintFor(props.symbol),
      }}
    >
      <Show
        when={showImg()}
        fallback={
          <span class="text-[10px] font-bold leading-none" style={{ "font-size": `${size() * 0.45}px`, "color": TEXT, "line-height": 1 }}>
            {initialsFor(props.symbol)}
          </span>
        }
      >
        <img
          src={props.logo as string}
          alt={props.symbol}
          width={size()}
          height={size()}
          onError={() => setFailed(true)}
          style={{ "width": `${size()}px`, "height": `${size()}px`, "object-fit": "contain", "display": "block" }}
        />
      </Show>
    </div>
  );
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.min(1, Math.max(0, v));
}

export function LocalSparkline(props: { data: number[]; change?: number; width?: number; height?: number }) {
  const change = () => props.change ?? 0;
  const width = () => props.width ?? 64;
  const height = () => props.height ?? 20;
  const positive = () => change() >= 0;
  const values = () => (Array.isArray(props.data) ? props.data : []).map(clamp01);

  const geometry = () => {
    const w = width();
    const h = height();
    const pad = 1.5;
    const vals = values();
    const innerW = Math.max(1, w - pad * 2);
    const innerH = Math.max(1, h - pad * 2);

    if (vals.length === 0) {
      const y = (h / 2).toFixed(1);
      return `${pad},${y} ${(w - pad).toFixed(1)},${y}`;
    }
    if (vals.length === 1) {
      const y = (h - pad - vals[0] * innerH).toFixed(1);
      return `${pad},${y} ${(w - pad).toFixed(1)},${y}`;
    }
    return vals
      .map((v, i) => {
        const x = pad + (i / (vals.length - 1)) * innerW;
        const y = h - pad - v * innerH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  };

  return (
    <div
      data-testid="sparkline"
      data-positive={positive() ? "true" : "false"}
      data-points={values().length}
      class="inline-flex flex-shrink-0 items-center"
      style={{ "width": `${width()}px`, "height": `${height()}px` }}
    >
      <svg
        width={width()}
        height={height()}
        viewBox={`0 0 ${width()} ${height()}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <polyline
          points={geometry()}
          fill="none"
          stroke={positive() ? "var(--color-fin-positive)" : "var(--color-fin-negative)"}
          stroke-width={1.5}
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>
  );
}
