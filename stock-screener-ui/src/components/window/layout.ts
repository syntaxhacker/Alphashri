import type { WindowLayout, WindowState } from "./types";

export interface Rect { x: number; y: number; w: number; h: number; }
export interface CanvasSize { w: number; h: number; }
export interface MinSize { w: number; h: number; }

export const TITLE_BAR_H = 28;
/** Horizontal strip that must stay on screen so the title bar can always be grabbed. */
export const MIN_VISIBLE_X = 60;
export const DEFAULT_MIN_SIZE: MinSize = { w: 240, h: 120 };
export const DEFAULT_WINDOW_SIZE: MinSize = { w: 420, h: 260 };

/** Fallback canvas used only when a caller passes an unusable size. */
const DEFAULT_CANVAS_FALLBACK: CanvasSize = { w: 1280, h: 800 };
/** A newly added window fills most of one column, not a 420px postage stamp. */
export const NEW_WINDOW_WIDTH_FRAC = 0.52;
export const NEW_WINDOW_HEIGHT_FRAC = 0.82;
export const KEYBOARD_STEP = 10;
export const CASCADE_STEP = 24;
export const CASCADE_COUNT = 6;
export const FIT_PADDING = 8;
export const LAYOUT_WIRE_VERSION = 1;
export const RESIZE_DIRS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;
export type ResizeDir = (typeof RESIZE_DIRS)[number];

const finite = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const within = (value: number, lo: number, hi: number): number => {
  const upper = Math.max(lo, hi);
  return Math.min(upper, Math.max(lo, value));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Rectangles stay partly off-canvas on purpose (that is the desktop model), but
 * a window is never fully lost: 60px of its horizontal span and its whole title
 * bar remain reachable. Rects are immutable — every helper returns a new object.
 */
export function clampToCanvas(
  rect: Rect,
  canvas: CanvasSize,
  minSize: MinSize = DEFAULT_MIN_SIZE,
  titleBarH: number = TITLE_BAR_H,
): Rect {
  const cw = Math.max(0, finite(canvas.w));
  const ch = Math.max(0, finite(canvas.h));
  const mw = Math.max(1, finite(minSize.w, DEFAULT_MIN_SIZE.w));
  const mh = Math.max(1, finite(minSize.h, DEFAULT_MIN_SIZE.h));
  const bar = Math.max(1, finite(titleBarH, TITLE_BAR_H));
  const w = Math.max(mw, finite(rect.w, mw));
  const h = Math.max(mh, finite(rect.h, mh));
  return {
    x: within(finite(rect.x), -(w - MIN_VISIBLE_X), cw - MIN_VISIBLE_X),
    y: within(finite(rect.y), 0, Math.max(0, ch - bar)),
    w,
    h,
  };
}

/** Resize one of the eight handles; the edge opposite the drag stays pinned. */
export function resizeRect(
  rect: Rect,
  dir: string,
  dx: number,
  dy: number,
  canvas: CanvasSize,
  minSize: MinSize = DEFAULT_MIN_SIZE,
): Rect {
  const ox = finite(rect.x);
  const oy = finite(rect.y);
  const ow = Math.max(1, finite(rect.w, minSize.w));
  const oh = Math.max(1, finite(rect.h, minSize.h));
  const mw = Math.max(1, finite(minSize.w, DEFAULT_MIN_SIZE.w));
  const mh = Math.max(1, finite(minSize.h, DEFAULT_MIN_SIZE.h));
  let x = ox;
  let y = oy;
  let w = ow;
  let h = oh;

  if (dir.includes("e")) w = ow + dx;
  if (dir.includes("s")) h = oh + dy;
  if (dir.includes("w")) {
    w = ow - dx;
    x = ox + dx;
  }
  if (dir.includes("n")) {
    h = oh - dy;
    y = oy + dy;
  }
  // Clamp against the minimum at the dragged edge, not both edges: moving the
  // opposite edge would make the window appear to jump while resizing.
  if (w < mw) {
    if (dir.includes("w")) x = ox + ow - mw;
    w = mw;
  }
  if (h < mh) {
    if (dir.includes("n")) y = oy + oh - mh;
    h = mh;
  }
  return clampToCanvas({ x, y, w, h }, canvas, minSize);
}

/** Raise a window above every other one; ties resolve in array order. */
export function raiseToFront(windows: WindowState[], id: string): WindowState[] {
  if (!windows.some((w) => w.id === id)) return windows;
  const maxZ = windows.reduce((max, w) => Math.max(max, finite(w.z)), 0);
  // Only the raised window gets a new object: siblings keep identity so the desk
  // does not re-render eight frames for one focus.
  return windows.map((w) => (w.id === id ? { ...w, z: maxZ + 1 } : w));
}

/**
 * Off-screen recovery. Scale the union of all rects down to fit (never up),
 * translate it into the padding box, then re-stack z deterministically by the
 * previous order. `maximized` is cleared so the fitted rect is the real one.
 */
export function fitAllToScreen(
  windows: WindowState[],
  canvas: CanvasSize,
  minSize: MinSize = DEFAULT_MIN_SIZE,
): WindowState[] {
  if (windows.length === 0) return [];
  const cw = Math.max(0, finite(canvas.w));
  const ch = Math.max(0, finite(canvas.h));
  const rects = windows.map((w) => ({
    x: finite(w.x),
    y: finite(w.y),
    w: Math.max(1, finite(w.w, minSize.w)),
    h: Math.max(1, finite(w.h, minSize.h)),
  }));
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  const spanW = Math.max(1, maxX - minX);
  const spanH = Math.max(1, maxY - minY);
  /* Never shrink below a legible title bar + a visible sliver of content. */
  const fitMinW = Math.min(minSize.w, Math.max(120, Math.round(cw * 0.6)));
  const fitMinH = Math.min(minSize.h, Math.max(80, Math.round(ch * 0.3)));
  const scale = Math.min(
    1,
    Math.max(0.1, (cw - 2 * FIT_PADDING) / spanW),
    Math.max(0.1, (ch - 2 * FIT_PADDING) / spanH),
  );

  return windows
    .map((win, index) => ({ win, rect: rects[index] }))
    .sort((a, b) => finite(a.win.z) - finite(b.win.z) || a.win.id.localeCompare(b.win.id))
    .map(({ win, rect }, index) => ({
      ...win,
      ...clampToCanvas(
        {
          x: FIT_PADDING + (rect.x - minX) * scale,
          y: FIT_PADDING + (rect.y - minY) * scale,
          /*
           * Deliberately *not* floored at `minSize`. That is the minimum a
           * window may be dragged to interactively (240px); honouring it here
           * made the scaler a no-op — three 583px windows computed a 117px
           * width, got floored back to 240, and still overflowed a 358px
           * canvas. Fit-all exists to make everything visible, so it may
           * shrink below the interactive floor, down to a usable sliver.
           */
          w: Math.max(fitMinW, rect.w * scale),
          h: Math.max(fitMinH, rect.h * scale),
        },
        canvas,
        { w: fitMinW, h: fitMinH },
      ),
      z: index + 1,
      maximized: false,
    }));
}

/**
 * Saved layouts are untrusted (the `view:"map"` lesson): unknown panel types
 * are dropped, rects are clamped, duplicate ids are ignored and nothing throws.
 */
export function parseLayout(
  raw: unknown,
  knownTypes: ReadonlySet<string>,
  canvas: CanvasSize,
  minSize: MinSize = DEFAULT_MIN_SIZE,
): WindowLayout | null {
  let data: unknown = raw;
  if (typeof raw === "string") {
    if (raw.trim().length === 0) return null;
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(data) || !Array.isArray(data.windows)) return null;

  const seen = new Set<string>();
  const windows: WindowState[] = [];
  for (const entry of data.windows) {
    if (!isRecord(entry)) continue;
    const id = entry.id;
    const type = entry.type;
    if (typeof id !== "string" || id.length === 0) continue;
    if (typeof type !== "string" || !knownTypes.has(type)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const rect = clampToCanvas(
      {
        x: finite(entry.x),
        y: finite(entry.y),
        w: finite(entry.w, minSize.w),
        h: finite(entry.h, minSize.h),
      },
      canvas,
      minSize,
    );
    const title = typeof entry.title === "string" && entry.title.trim().length > 0
      ? entry.title
      : type;
    windows.push({
      id,
      type,
      title,
      ...rect,
      z: finite(entry.z, windows.length + 1),
      minimized: entry.minimized === true,
      maximized: entry.maximized === true,
    });
  }

  const name = typeof data.name === "string" && data.name.trim().length > 0
    ? data.name
    : undefined;
  return { windows, ...(name ? { name } : {}) };
}

export function serializeLayout(layout: WindowLayout): string {
  return JSON.stringify({
    v: LAYOUT_WIRE_VERSION,
    ...(layout.name ? { name: layout.name } : {}),
    windows: layout.windows.map((w) => ({
      id: w.id,
      type: w.type,
      title: w.title,
      x: w.x,
      y: w.y,
      w: w.w,
      h: w.h,
      z: w.z,
      minimized: w.minimized === true,
      maximized: w.maximized === true,
    })),
  });
}

/**
 * `x/y/w/h` is always the restore rect; `maximized` is a render-time flag. That
 * is what makes restore byte-exact without a second shadow rect in the payload.
 */
export function maximize(windows: WindowState[], id: string, canvas: CanvasSize): WindowState[] {
  if (finite(canvas.w) <= 0 || finite(canvas.h) <= 0) return windows;
  return windows.map((w) => (w.id === id ? { ...w, maximized: true } : w));
}

export function restore(windows: WindowState[], id: string): WindowState[] {
  return windows.map((w) => (w.id === id ? { ...w, maximized: false } : w));
}

export function geometryOf(state: WindowState, canvas: CanvasSize): Rect {
  return state.maximized
    ? { x: 0, y: 0, w: Math.max(0, finite(canvas.w)), h: Math.max(0, finite(canvas.h)) }
    : { x: state.x, y: state.y, w: state.w, h: state.h };
}

/** A gesture that ends where it started must not push a no-op layout save. */
export function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** Deterministic cascade for a newly added window; wraps after six slots. */
/**
 * Cascade origin/size for a newly added window. The rect is proportional to the
 * canvas rather than a fixed 420x260: on a 1740px desk that literal covered 6%
 * of the area and clipped any table taller than ~8 rows, so a freshly added
 * panel looked broken. Fractions keep a new window useful at any canvas size.
 *
 * `size` still wins when a caller passes an explicit rect.
 */
export function cascadeRect(
  index: number,
  canvas: CanvasSize,
  size: MinSize = DEFAULT_WINDOW_SIZE,
): Rect {
  const slot = ((Math.floor(finite(index)) % CASCADE_COUNT) + CASCADE_COUNT) % CASCADE_COUNT;
  const explicit =
    finite(size.w, 0) > 0 && size !== DEFAULT_WINDOW_SIZE;
  const w = explicit
    ? finite(size.w, DEFAULT_WINDOW_SIZE.w)
    : Math.round(finite(canvas.w, DEFAULT_CANVAS_FALLBACK.w) * NEW_WINDOW_WIDTH_FRAC);
  const h = explicit
    ? finite(size.h, DEFAULT_WINDOW_SIZE.h)
    : Math.round(finite(canvas.h, DEFAULT_CANVAS_FALLBACK.h) * NEW_WINDOW_HEIGHT_FRAC);
  const slackX = Math.max(0, finite(canvas.w, 0) - w - FIT_PADDING * 2);
  const slackY = Math.max(0, finite(canvas.h, 0) - h - FIT_PADDING * 2);
  const stepX = Math.min(CASCADE_STEP, Math.round(slackX / Math.max(1, CASCADE_COUNT - 1)));
  const stepY = Math.min(CASCADE_STEP, Math.round(slackY / Math.max(1, CASCADE_COUNT - 1)));
  return clampToCanvas(
    {
      x: FIT_PADDING + slot * stepX,
      y: FIT_PADDING + slot * stepY,
      w: Math.max(1, w),
      h: Math.max(1, h),
    },
    canvas,
    DEFAULT_MIN_SIZE,
  );
}
