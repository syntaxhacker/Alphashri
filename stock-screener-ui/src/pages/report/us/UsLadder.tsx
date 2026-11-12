import { useMemo } from "react";

import { Box, Text } from "@/ui";
import { NEGATIVE, POSITIVE, SCALE_DARK, WARNING } from "@/ui/palette";
import type { UsRow } from "../../../types/usReport";
import { buildLadder, fmtInt } from "./usReportMath";

const ROW_H = 18;

/** Dense terminal ladder: put OI left, call OI right, walls + spot marked. */
export function UsLadder({ row }: { row: UsRow }) {
  const { rows, maxOi } = useMemo(() => buildLadder(row), [row]);

  return (
    <Box
      data-testid="us-ladder"
      className="flex flex-col min-h-0 flex-1 border border-fin-border font-mono tabular-nums text-[10.5px] overflow-hidden"
      style={{ lineHeight: `${ROW_H}px` }}
    >
      <Box
        className="flex items-center px-1 text-fin-text-muted border-b border-fin-border text-[9.5px] tracking-[0.4px] shrink-0"
      >
        <Box className="w-[52px] text-right" style={{ color: NEGATIVE }}>PUT OI</Box>
        <Box className="flex-1" />
        <Box className="w-[62px] text-center">STRIKE</Box>
        <Box className="flex-1" />
        <Box className="w-[52px] text-left" style={{ color: POSITIVE }}>CALL OI</Box>
      </Box>

      <Box className="flex-1 min-h-0 overflow-auto">
        {rows.map((r) => {
          if (r.isMarker) {
            return (
              <Box
                key="spot"
                className="flex items-center px-1 font-bold bg-[rgba(88,166,255,0.16)] text-fin-info"
                style={{ height: ROW_H }}
              >
                <Box className="w-[52px]" />
                <Box className="flex-1 opacity-70 border-t border-dashed border-fin-info" />
                <Box className="w-[62px] text-center">{fmtInt(row.spot)}</Box>
                <Box className="flex-1 opacity-70 border-t border-dashed border-fin-info" />
                <Box className="w-[52px]" />
              </Box>
            );
          }

          const isPain = r.isMaxPain;
          return (
            <Box
              key={r.k}
              data-testid={`us-ladder-row-${r.k}`}
              className="flex items-center px-1 hover:bg-white/[0.04]"
              style={{
                height: ROW_H,
                borderLeft: r.isPutWall ? `2px solid ${NEGATIVE}` : "2px solid transparent",
                borderRight: r.isCallWall ? `2px solid ${POSITIVE}` : "2px solid transparent",
                backgroundColor: r.isSpot
                  ? "rgba(88,166,255,0.16)"
                  : isPain
                    ? "rgba(240,136,62,0.10)"
                    : "transparent",
              }}
            >
              <Box className="w-[50px] text-right" style={{ color: r.p_oi ? NEGATIVE : SCALE_DARK[3] }}>
                {fmtInt(r.p_oi)}
              </Box>
              <Box className="flex-1 flex justify-end pr-1">
                <Box className="h-[7px] opacity-75 bg-fin-negative" style={{ width: `${(r.p_oi / maxOi) * 100}%`, maxWidth: "100%" }} />
              </Box>
              <Box
                className={`w-[66px] text-center ${r.isPutWall || r.isCallWall ? "font-extrabold" : "font-medium"}`}
                style={{ color: isPain ? WARNING : undefined }}
              >
                {fmtInt(r.k)}
              </Box>
              <Box className="flex-1 flex pl-1">
                <Box className="h-[7px] opacity-75 bg-fin-positive" style={{ width: `${(r.c_oi / maxOi) * 100}%`, maxWidth: "100%" }} />
              </Box>
              <Box className="w-[50px] text-left" style={{ color: r.c_oi ? POSITIVE : SCALE_DARK[3] }}>
                {fmtInt(r.c_oi)}
              </Box>
            </Box>
          );
        })}
      </Box>

      <Box
        className="shrink-0 px-1 py-0.5 border-t border-fin-border text-fin-text-muted text-[9px] flex gap-[10px] flex-wrap"
      >
        <Text size="xs" c="dimmed" span>
          wall {fmtInt(row.put_wall)}P / {fmtInt(row.call_wall)}C
        </Text>
        <Text size="xs" c="dimmed" span>
          pain {fmtInt(row.max_pain)}
        </Text>
        <Text size="xs" c="dimmed" span>
          GEX {row.net_gex ? `${row.net_gex >= 0 ? "+" : ""}${row.net_gex.toFixed(0)}m` : "–"}
        </Text>
      </Box>
    </Box>
  );
}
