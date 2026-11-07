import { Fragment, useMemo } from "react";
import { Box, Text, Tooltip } from "@/ui";
import { CREAM, MONO, TEXT, TEXT_MUTED } from "@/ui/palette";
import { withAlpha } from "@/utils/color";
import { formatPercentage } from "@/utils/ui-helpers";
import type { RotationQuadrant, RotationRow } from "@/types/rotation";

const QUADRANT_COLORS: Record<RotationQuadrant, string> = {
  leading: "#4C9A8F",
  improving: "#5B8DEF",
  weakening: "#C9A227",
  lagging: "#C05A5A",
};

const QUADRANT_LABELS: Record<RotationQuadrant, string> = {
  leading: "LEADING",
  improving: "IMPROVING",
  weakening: "WEAKENING",
  lagging: "LAGGING",
};

const MAX_LABELS = 10;

/** Data-driven domain that always contains the 50% benchmark line. */
function domainOf(values: number[]): { lo: number; hi: number } {
  if (values.length === 0) return { lo: 25, hi: 75 };
  const min = Math.min(50, ...values);
  const max = Math.max(50, ...values);
  const span = Math.max(8, max - min);
  const pad = span * 0.14;
  return { lo: Math.max(0, min - pad), hi: Math.min(100, max + pad) };
}

function scale(value: number, domain: { lo: number; hi: number }): number {
  const span = domain.hi - domain.lo || 1;
  return Math.max(0, Math.min(100, ((value - domain.lo) / span) * 100));
}

function extremity(row: RotationRow): number {
  return Math.abs(row.rs_pct - 50) + Math.abs(row.mom_pct - 50);
}

function shortName(name: string): string {
  return name.length > 22 ? `${name.slice(0, 21)}…` : name;
}

/** Dot radius grows with the group's member count (4–9px). */
function dotRadius(row: RotationRow): number {
  return 4 + Math.min(5, Math.sqrt(Math.max(1, row.members)) * 0.55);
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <>
      <Text sx={{ fontSize: 9.5, lineHeight: 1.35, color: "text.secondary" }}>{label}</Text>
      <Text
        sx={{
          fontSize: 9.5,
          lineHeight: 1.35,
          fontFamily: MONO,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </Text>
    </>
  );
}

export interface RotationRrgProps {
  rows: RotationRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function RotationRrg({ rows, selectedId, onSelect }: RotationRrgProps) {
  const xDomain = useMemo(() => domainOf(rows.map((r) => r.rs_pct)), [rows]);
  const yDomain = useMemo(() => domainOf(rows.map((r) => r.mom_pct)), [rows]);
  const x = (v: number) => scale(v, xDomain);
  const y = (v: number) => scale(v, yDomain);
  const cx = x(50);
  const cy = y(50);

  // Labels: the most extreme groups plus the selection, dropping any label
  // whose anchor sits on top of one already placed.
  const labelledIds = useMemo(() => {
    const placed: { x: number; y: number }[] = [];
    const ids = new Set<string>();
    const sorted = [...rows].sort((a, b) => extremity(b) - extremity(a));
    for (const row of sorted) {
      if (ids.size >= MAX_LABELS && row.id !== selectedId) continue;
      const px = scale(row.rs_pct, xDomain);
      const py = scale(row.mom_pct, yDomain);
      const collides = placed.some((p) => Math.abs(p.x - px) < 8 && Math.abs(p.y - py) < 7);
      if (collides && row.id !== selectedId) continue;
      placed.push({ x: px, y: py });
      ids.add(row.id);
    }
    return ids;
  }, [rows, selectedId, xDomain, yDomain]);

  const counts = useMemo(() => {
    const base: Record<RotationQuadrant, number> = {
      leading: 0,
      improving: 0,
      weakening: 0,
      lagging: 0,
    };
    for (const row of rows) base[row.quadrant] += 1;
    return base;
  }, [rows]);

  const xTicks = [xDomain.lo, 50, xDomain.hi];
  const yTicks = [yDomain.lo, 50, yDomain.hi];

  return (
    <Box
      data-testid="rotation-rrg"
      sx={{ display: "flex", flexDirection: "column", flex: 1, height: "100%", minHeight: 0, minWidth: 0 }}
    >
      <Box sx={{ flex: 1, minHeight: 0, display: "flex", gap: 0.75, p: 1, pb: 0.5 }}>
        <Box
          sx={{
            width: 12,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Box
            component="span"
            sx={{
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
              fontSize: 9,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              color: TEXT_MUTED,
              whiteSpace: "nowrap",
            }}
          >
            Momentum
          </Box>
        </Box>

        <Box
          data-testid="rotation-rrg-chart"
          sx={{
            position: "relative",
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            overflow: "hidden",
            bgcolor: "background.paper",
          }}
        >
          {rows.length === 0 ? (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text sx={{ fontSize: 11, color: TEXT_MUTED }}>No rotation groups</Text>
            </Box>
          ) : (
            <>
              {/* Quadrant tints anchored to the scaled 50/50 split. */}
              {(
                [
                  { key: "improving", left: 0, top: 0, w: cx, h: 100 - cy },
                  { key: "leading", left: cx, top: 0, w: 100 - cx, h: 100 - cy },
                  { key: "lagging", left: 0, top: 100 - cy, w: cx, h: cy },
                  { key: "weakening", left: cx, top: 100 - cy, w: 100 - cx, h: cy },
                ] as const
              ).map(({ key, left, top, w, h }) => {
                const color = QUADRANT_COLORS[key];
                const topSide = top === 0;
                const leftSide = left === 0;
                return (
                  <Box
                    key={key}
                    sx={{
                      position: "absolute",
                      left: `${left}%`,
                      top: `${top}%`,
                      width: `${w}%`,
                      height: `${h}%`,
                      bgcolor: withAlpha(color, 0.055),
                      pointerEvents: "none",
                    }}
                  >
                    <Box
                      component="span"
                      sx={{
                        position: "absolute",
                        top: topSide ? 5 : "auto",
                        bottom: topSide ? "auto" : 5,
                        left: leftSide ? 6 : "auto",
                        right: leftSide ? "auto" : 6,
                        fontSize: 8.5,
                        fontWeight: 700,
                        letterSpacing: 0.6,
                        color: withAlpha(color, 0.95),
                        whiteSpace: "nowrap",
                      }}
                    >
                      {QUADRANT_LABELS[key]}
                    </Box>
                  </Box>
                );
              })}

              {/* Benchmark crosshair. */}
              <Box
                sx={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${cx}%`,
                  borderLeft: "1px dashed var(--mui-palette-divider)",
                  pointerEvents: "none",
                }}
              />
              <Box
                sx={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: `${cy}%`,
                  borderTop: "1px dashed var(--mui-palette-divider)",
                  pointerEvents: "none",
                }}
              />

              {xTicks.map((tick) => {
                const isLo = tick === xDomain.lo;
                const isHi = tick === xDomain.hi;
                return (
                  <Box
                    key={`xt-${tick}`}
                    sx={{
                      position: "absolute",
                      left: isLo ? 4 : isHi ? "auto" : `${x(tick)}%`,
                      right: isHi ? 4 : "auto",
                      bottom: 3,
                      transform: isLo || isHi ? "none" : "translateX(-50%)",
                      fontSize: 8,
                      color: TEXT_MUTED,
                      fontVariantNumeric: "tabular-nums",
                      pointerEvents: "none",
                    }}
                  >
                    {Math.round(tick)}
                  </Box>
                );
              })}
              {yTicks.map((tick) => {
                const isLo = tick === yDomain.lo;
                const isHi = tick === yDomain.hi;
                return (
                  <Box
                    key={`yt-${tick}`}
                    sx={{
                      position: "absolute",
                      right: 4,
                      bottom: isLo ? 2 : isHi ? "auto" : `${y(tick)}%`,
                      top: isHi ? 2 : "auto",
                      transform: isLo || isHi ? "none" : "translateY(50%)",
                      fontSize: 8,
                      color: TEXT_MUTED,
                      fontVariantNumeric: "tabular-nums",
                      pointerEvents: "none",
                    }}
                  >
                    {Math.round(tick)}
                  </Box>
                );
              })}

              {rows.map((row, index) => {
                const color = QUADRANT_COLORS[row.quadrant];
                const selected = row.id === selectedId;
                const r = dotRadius(row) + (selected ? 2 : 0);
                const px = x(row.rs_pct);
                const py = y(row.mom_pct);
                const below = (index % 2 === 1 || py > 80) && !selected && py > 6;
                const anchor =
                  px > 80 ? "translateX(-100%)" : px < 20 ? "none" : "translateX(-50%)";
                return (
                  <Fragment key={row.id}>
                    <Box
                      sx={{
                        position: "absolute",
                        left: `${px}%`,
                        bottom: `${py}%`,
                        transform: "translate(-50%, 50%)",
                        zIndex: selected ? 6 : 3,
                      }}
                    >
                      <Tooltip
                        position="top"
                        openDelay={120}
                        withArrow
                        label={
                          <Box sx={{ minWidth: 148 }}>
                            <Text sx={{ fontSize: 11, fontWeight: 700, lineHeight: 1.25 }}>
                              {row.name}
                            </Text>
                            <Text sx={{ fontSize: 9.5, lineHeight: 1.3, color: "text.secondary" }}>
                              {row.category || row.kind} · {row.members} members
                            </Text>
                            <Box
                              sx={{
                                display: "grid",
                                gridTemplateColumns: "auto auto",
                                columnGap: 1.5,
                                rowGap: 0.25,
                                mt: 0.5,
                              }}
                            >
                              <Meta label="1D" value={formatPercentage(row.returns["1D"], 2, true)} />
                              <Meta label="1W" value={formatPercentage(row.returns["1W"], 2, true)} />
                              <Meta label="1M" value={formatPercentage(row.returns["1M"], 2, true)} />
                              <Meta label="RS 1M" value={row.rs_1m.toFixed(2)} />
                              <Meta label="Breadth" value={`${row.breadth.toFixed(0)}%`} />
                              <Meta label="Status" value={row.status.toUpperCase()} />
                            </Box>
                          </Box>
                        }
                      >
                        <Box
                          component="button"
                          type="button"
                          aria-label={`${row.name} — ${QUADRANT_LABELS[row.quadrant]}`}
                          onClick={() => onSelect(row.id)}
                          sx={{
                            display: "block",
                            width: r * 2,
                            height: r * 2,
                            p: 0,
                            borderRadius: "50%",
                            border: selected
                              ? `1.5px solid ${CREAM}`
                              : `1px solid ${withAlpha(color, 0.9)}`,
                            bgcolor: withAlpha(color, selected ? 1 : 0.9),
                            boxShadow: selected
                              ? `0 0 0 3px ${withAlpha(color, 0.25)}`
                              : "none",
                            cursor: "pointer",
                            transition: "transform 120ms ease",
                            "&:hover": { transform: "scale(1.35)" },
                            "&:focus-visible": { outline: `1px solid ${CREAM}`, outlineOffset: 2 },
                          }}
                        />
                      </Tooltip>
                    </Box>
                    {labelledIds.has(row.id) ? (
                      <Box
                        sx={{
                          position: "absolute",
                          left: `${px}%`,
                          ...(below
                            ? { top: `calc(${100 - py}% + ${r + 5}px)` }
                            : { bottom: `calc(${py}% + ${r + 5}px)` }),
                          transform: anchor,
                          maxWidth: 132,
                          pointerEvents: "none",
                          zIndex: selected ? 5 : 2,
                          px: 0.25,
                          borderRadius: 0.5,
                          bgcolor: selected
                            ? "background.paper"
                            : withAlpha("#000000", 0.38),
                        }}
                      >
                        <Text
                          sx={{
                            fontSize: 9.5,
                            lineHeight: 1.2,
                            fontWeight: selected ? 700 : 500,
                            color: selected ? TEXT : TEXT_MUTED,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {shortName(row.name)}
                        </Text>
                      </Box>
                    ) : null}
                  </Fragment>
                );
              })}
            </>
          )}
        </Box>
      </Box>

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          px: 1,
          pb: 0.75,
          minWidth: 0,
        }}
      >
        <Text sx={{ fontSize: 9, letterSpacing: 0.6, textTransform: "uppercase", color: TEXT_MUTED }}>
          RS 1M percentile
        </Text>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0, overflow: "hidden" }}>
          {(["leading", "improving", "weakening", "lagging"] as RotationQuadrant[]).map((key) => (
            <Box key={key} sx={{ display: "inline-flex", alignItems: "center", gap: 0.4 }}>
              <Box
                sx={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  bgcolor: QUADRANT_COLORS[key],
                  flexShrink: 0,
                }}
              />
              <Text sx={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 0.3, color: TEXT_MUTED }}>
                {QUADRANT_LABELS[key]}
              </Text>
              <Text
                sx={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: TEXT_MUTED,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {counts[key]}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
