import { useMemo } from "react";

import { Box, Text } from "@/ui";
import { MONO, NEGATIVE, POSITIVE, WARNING } from "@/ui/palette";
import type { UsRow } from "../../../types/usReport";
import { buildLadder, fmtInt } from "./usReportMath";

const ROW_H = 18;

/** Dense terminal ladder: put OI left, call OI right, walls + spot marked. */
export function UsLadder({ row }: { row: UsRow }) {
  const { rows, maxOi } = useMemo(() => buildLadder(row), [row]);

  return (
    <Box
      data-testid="us-ladder"
      sx={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        flex: 1,
        border: "1px solid var(--mui-palette-divider)",
        fontFamily: MONO,
        fontVariantNumeric: "tabular-nums",
        fontSize: 10.5,
        lineHeight: `${ROW_H}px`,
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          px: 0.5,
          color: "var(--mui-palette-text-secondary)",
          borderBottom: "1px solid var(--mui-palette-divider)",
          fontSize: 9.5,
          letterSpacing: 0.4,
          flex: "0 0 auto",
        }}
      >
        <Box sx={{ width: 52, textAlign: "right", color: NEGATIVE }}>PUT OI</Box>
        <Box sx={{ flex: 1 }} />
        <Box sx={{ width: 62, textAlign: "center" }}>STRIKE</Box>
        <Box sx={{ flex: 1 }} />
        <Box sx={{ width: 52, textAlign: "left", color: POSITIVE }}>CALL OI</Box>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {rows.map((r) => {
          if (r.isMarker) {
            return (
              <Box
                key="spot"
                sx={{
                  display: "flex",
                  alignItems: "center",
                  px: 0.5,
                  height: ROW_H,
                  bgcolor: "rgba(88,166,255,0.16)",
                  color: "var(--mui-palette-info-main)",
                  fontWeight: 700,
                }}
              >
                <Box sx={{ width: 52 }} />
                <Box sx={{ flex: 1, borderTop: "1px dashed var(--mui-palette-info-main)", opacity: 0.7 }} />
                <Box sx={{ width: 62, textAlign: "center" }}>{fmtInt(row.spot)}</Box>
                <Box sx={{ flex: 1, borderTop: "1px dashed var(--mui-palette-info-main)", opacity: 0.7 }} />
                <Box sx={{ width: 52 }} />
              </Box>
            );
          }

          const isPain = r.isMaxPain;
          return (
            <Box
              key={r.k}
              data-testid={`us-ladder-row-${r.k}`}
              sx={{
                display: "flex",
                alignItems: "center",
                px: 0.5,
                height: ROW_H,
                borderLeft: r.isPutWall ? `2px solid ${NEGATIVE}` : "2px solid transparent",
                borderRight: r.isCallWall ? `2px solid ${POSITIVE}` : "2px solid transparent",
                bgcolor: r.isSpot
                  ? "rgba(88,166,255,0.16)"
                  : isPain
                    ? "rgba(240,136,62,0.10)"
                    : "transparent",
                "&:hover": { bgcolor: "rgba(255,255,255,0.04)" },
              }}
            >
              <Box sx={{ width: 50, textAlign: "right", color: r.p_oi ? NEGATIVE : "var(--mui-palette-text-disabled)" }}>
                {fmtInt(r.p_oi)}
              </Box>
              <Box sx={{ flex: 1, display: "flex", justifyContent: "flex-end", pr: 0.5 }}>
                <Box sx={{ width: `${(r.p_oi / maxOi) * 100}%`, maxWidth: "100%", height: 7, bgcolor: NEGATIVE, opacity: 0.75 }} />
              </Box>
              <Box
                sx={{
                  width: 66,
                  textAlign: "center",
                  fontWeight: r.isPutWall || r.isCallWall ? 800 : 500,
                  color: isPain ? WARNING : "var(--mui-palette-text-primary)",
                }}
              >
                {fmtInt(r.k)}
              </Box>
              <Box sx={{ flex: 1, display: "flex", pl: 0.5 }}>
                <Box sx={{ width: `${(r.c_oi / maxOi) * 100}%`, maxWidth: "100%", height: 7, bgcolor: POSITIVE, opacity: 0.75 }} />
              </Box>
              <Box sx={{ width: 50, textAlign: "left", color: r.c_oi ? POSITIVE : "var(--mui-palette-text-disabled)" }}>
                {fmtInt(r.c_oi)}
              </Box>
            </Box>
          );
        })}
      </Box>

      <Box
        sx={{
          flex: "0 0 auto",
          px: 0.5,
          py: 0.25,
          borderTop: "1px solid var(--mui-palette-divider)",
          color: "var(--mui-palette-text-secondary)",
          fontSize: 9,
          display: "flex",
          gap: 1.25,
          flexWrap: "wrap",
        }}
      >
        <Text size="xs" c="dimmed" span>
          wall {fmtInt(row.put_wall)}P / {fmtInt(row.call_wall)}C
        </Text>
        <Text size="xs" c="dimmed" span>
          pain {fmtInt(row.max_pain)}
        </Text>
        <Text size="xs" c="dimmed" span>
          GEX {row.net_gex >= 0 ? "+" : ""}
          {row.net_gex.toFixed(0)}m
        </Text>
      </Box>
    </Box>
  );
}
