// FloatingWindow — dependency-free draggable/resizable window for full-bleed
// chart screens. Performance contract:
//  • moves/resizes use transform + width/height on the DOM node (no React state)
//  • pointermove is coalesced into one requestAnimationFrame
//  • geometry is committed to React once, on pointerup
//  • `will-change` is only set while a gesture is active
//  • content is memoized by the caller; window chrome re-renders at most per commit
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import Box from "@mui/material/Box";
import * as palette from "@/ui/palette";

export interface FloatingWindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloatingWindowProps {
  title: string;
  icon?: React.ReactNode;
  geometry: FloatingWindowGeometry;
  zIndex: number;
  minimized?: boolean;
  minWidth?: number;
  minHeight?: number;
  onFocus?: () => void;
  onClose?: () => void;
  onMinimize?: () => void;
  onGeometryChange?: (g: FloatingWindowGeometry) => void;
  children: React.ReactNode;
  testid?: string;
}

const RESIZE_DIRS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;
type ResizeDir = (typeof RESIZE_DIRS)[number];

const HANDLE_STYLE: Record<ResizeDir, React.CSSProperties> = {
  n: { top: -3, left: 8, right: 8, height: 6, cursor: "ns-resize" },
  s: { bottom: -3, left: 8, right: 8, height: 6, cursor: "ns-resize" },
  e: { right: -3, top: 8, bottom: 8, width: 6, cursor: "ew-resize" },
  w: { left: -3, top: 8, bottom: 8, width: 6, cursor: "ew-resize" },
  ne: { top: -4, right: -4, width: 12, height: 12, cursor: "nesw-resize" },
  nw: { top: -4, left: -4, width: 12, height: 12, cursor: "nwse-resize" },
  se: { bottom: -4, right: -4, width: 12, height: 12, cursor: "nwse-resize" },
  sw: { bottom: -4, left: -4, width: 12, height: 12, cursor: "nesw-resize" },
};

export interface FloatingWindowHandle {
  focus: () => void;
}

const FloatingWindow = forwardRef<FloatingWindowHandle, FloatingWindowProps>(function FloatingWindow(
  {
    title,
    icon,
    geometry,
    zIndex,
    minimized = false,
    minWidth = 260,
    minHeight = 140,
    onFocus,
    onClose,
    onMinimize,
    onGeometryChange,
    children,
    testid,
  },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  // Live geometry (kept in sync with props when no gesture is active) so a
  // re-render mid-gesture cannot reset the DOM we're moving imperatively.
  const geom = useRef<FloatingWindowGeometry>({ ...geometry });
  const gesture = useRef<boolean>(false);
  const rafRef = useRef(0);
  const pending = useRef<FloatingWindowGeometry | null>(null);

  useEffect(() => {
    if (!gesture.current) geom.current = { ...geometry };
  }, [geometry.x, geometry.y, geometry.width, geometry.height]);

  useImperativeHandle(ref, () => ({
    focus: () => onFocus?.(),
  }), [onFocus]);

  const beginGesture = (mode: "move" | "resize", e: React.PointerEvent, dir?: ResizeDir) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onFocus?.();
    gesture.current = true;
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...geom.current };
    const el = rootRef.current;
    if (el) el.style.willChange = mode === "move" ? "transform" : "transform, width, height";

    const parent = el?.parentElement;
    const pw = parent?.clientWidth || window.innerWidth;
    const ph = parent?.clientHeight || window.innerHeight;
    const clampX = (v: number) => Math.min(Math.max(-orig.width + 60, v), pw - 60);
    const clampY = (v: number) => Math.min(Math.max(0, v), ph - 28);

    const apply = () => {
      rafRef.current = 0;
      const g = pending.current;
      if (!g || !el) return;
      el.style.transform = `translate3d(${g.x}px, ${g.y}px, 0)`;
      el.style.width = `${g.width}px`;
      el.style.height = `${g.height}px`;
    };

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let { x, y, width, height } = orig;
      if (mode === "move") {
        x = clampX(orig.x + dx);
        y = clampY(orig.y + dy);
      } else if (dir) {
        if (dir.includes("e")) width = orig.width + dx;
        if (dir.includes("s")) height = orig.height + dy;
        if (dir.includes("w")) {
          width = orig.width - dx;
          x = orig.x + dx;
        }
        if (dir.includes("n")) {
          height = orig.height - dy;
          y = orig.y + dy;
        }
        width = Math.max(minWidth, width);
        height = Math.max(minHeight, height);
        if (width <= minWidth && dir.includes("w")) x = orig.x + (orig.width - minWidth);
        if (height <= minHeight && dir.includes("n")) y = orig.y + (orig.height - minHeight);
      }
      const g = { x, y, width, height };
      pending.current = g;
      geom.current = g;
      if (!rafRef.current) rafRef.current = requestAnimationFrame(apply);
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      if (el) el.style.willChange = "";
      gesture.current = false;
      const g = pending.current;
      pending.current = null;
      if (g && onGeometryChange) onGeometryChange(g);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (minimized) return null;

  return (
    <Box
      ref={rootRef}
      data-testid={testid}
      role="dialog"
      aria-label={title}
      onPointerDownCapture={() => onFocus?.()}
      sx={{
        position: "absolute",
        top: 0,
        left: 0,
        width: geometry.width,
        height: geometry.height,
        transform: `translate3d(${geometry.x}px, ${geometry.y}px, 0)`,
        zIndex,
        display: "flex",
        flexDirection: "column",
        bgcolor: palette.SURFACE,
        border: `1px solid ${palette.BORDER}`,
        borderRadius: 1,
        boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
        overflow: "hidden",
        contain: "layout paint style",
      }}
    >
      {/* Title bar (drag handle) */}
      <Box
        onPointerDown={(e) => beginGesture("move", e)}
        onDoubleClick={() => onMinimize?.()}
        sx={{
          flex: "0 0 auto",
          height: 28,
          px: 1,
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          cursor: "move",
          userSelect: "none",
          bgcolor: palette.SURFACE_ALT,
          borderBottom: `1px solid ${palette.BORDER}`,
          touchAction: "none",
        }}
      >
        {icon}
        <Box component="span" sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: palette.TEXT, textTransform: "uppercase", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {title}
        </Box>
        <Box
          role="button"
          aria-label={`Minimize ${title}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onMinimize?.()}
          sx={{ width: 18, height: 18, display: "grid", placeItems: "center", borderRadius: 0.5, color: palette.TEXT_MUTED, cursor: "pointer", fontSize: 14, lineHeight: 1, "&:hover": { bgcolor: palette.BORDER } }}
        >
          –
        </Box>
        <Box
          role="button"
          aria-label={`Close ${title}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onClose?.()}
          sx={{ width: 18, height: 18, display: "grid", placeItems: "center", borderRadius: 0.5, color: palette.TEXT_MUTED, cursor: "pointer", fontSize: 13, lineHeight: 1, "&:hover": { bgcolor: palette.NEGATIVE, color: "#fff" } }}
        >
          ✕
        </Box>
      </Box>

      {/* Body */}
      <Box sx={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "auto", display: "flex", flexDirection: "column" }}>
        {children}
      </Box>

      {/* Resize handles */}
      {RESIZE_DIRS.map((dir) => (
        <Box
          key={dir}
          onPointerDown={(e) => beginGesture("resize", e, dir)}
          sx={{ position: "absolute", touchAction: "none", ...HANDLE_STYLE[dir] }}
        />
      ))}
    </Box>
  );
});

export default FloatingWindow;
