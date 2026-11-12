/**
 * Local Solid-native twins of src/components/screener/Sparkline.tsx and
 * SymbolAvatar.tsx — those files are still importing the broken @/ui Box and
 * cannot mount. Keeps the same props and data-* contracts (sparkline,
 * symbol-avatar, data-positive, data-points, data-fallback, data-symbol).
 */
import { createEffect, createSignal, Show, type JSX } from "solid-js";
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
        minWidth: `${size()}px`,
        minHeight: `${size()}px`,
        backgroundColor: showImg() ? "var(--color-fin-surface-alt)" : tintFor(props.symbol),
      }}
    >
      <Show
        when={showImg()}
        fallback={
          <span class="text-[10px] font-bold leading-none" style={{ fontSize: `${size() * 0.45}px`, "color": TEXT, lineHeight: 1 }}>
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
          style={{ "width": `${size()}px`, "height": `${size()}px`, objectFit: "contain", "display": "block" }}
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


export function LocalCompactPanel(props: {
  title: string;
  testId?: string;
  style?: JSX.CSSProperties;
  children: JSX.Element;
}) {
  return (
    <div
      data-testid={props.testId}
      class="flex flex-col border border-fin-border rounded-[8px] overflow-hidden font-mono"
      style={props.style}
    >
      <div class="flex items-center justify-between gap-2 px-2 py-1 border-b border-fin-border bg-fin-surface shrink-0">
        <span class="text-[10px] font-bold uppercase tracking-[0.07em] text-fin-text-secondary">
          {props.title}
        </span>
      </div>
      <div class="flex flex-col gap-1 p-[6px]">{props.children}</div>
    </div>
  );
}

export function LocalCompactStat(props: {
  testId?: string;
  label: string;
  tone?: string;
  value: JSX.Element | string;
  hint?: JSX.Element | string;
}) {
  return (
    <div
      data-testid={props.testId}
      class="flex flex-col items-center justify-center text-center gap-0.5 bg-fin-surface border border-fin-border rounded-[4px] px-1 py-1.5 min-w-0"
    >
      <span class="text-[9px] uppercase tracking-[0.06em] leading-[1.1] text-fin-text-muted">
        {props.label}
      </span>
      <span
        class="text-[11px] font-bold leading-none tabular-nums"
        style={{ color: props.tone ?? "var(--color-fin-text)" }}
      >
        {props.value}
      </span>
      <Show when={props.hint}>
        <span class="text-[8px] leading-[1.1] text-fin-text-muted">{props.hint}</span>
      </Show>
    </div>
  );
}

export function LocalEmptyState(props: { testId?: string; title: string; description: string }) {
  return (
    <div data-testid={props.testId} class="flex flex-col items-center justify-center gap-1 py-4 px-2 text-center">
      <span class="text-[11px] font-semibold leading-tight text-fin-text">{props.title}</span>
      <span class="text-[9px] leading-snug text-fin-text-muted">{props.description}</span>
    </div>
  );
}
