import { memo, useMemo } from "react";
import Box from "@mui/material/Box";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { CompactPanel } from "@/components/common/compact";
import {
  buildVolumeProfile,
  formatProfileCompact,
  type NiftyVolumeTapeRow,
} from "./niftyVolumeProfile";

const SVG_W = 560;
const GUTTER = 52;
const CENTER = SVG_W / 2;
const HALF = SVG_W / 2 - GUTTER - 8;

/** CE = red (left), PE = green (right) — per the desk spec. */
const CE_FILL = palette.NEGATIVE;
const PE_FILL = palette.POSITIVE;
const OI_STROKE = palette.TEXT_MUTED;

interface NiftyVolumeProfileProps {
  rows?: NiftyVolumeTapeRow[] | null;
  /** Reference spot for the ±window + ATM anchor (defaults to the tape). */
  spot?: number | null;
  widthPts?: number;
  testId?: string;
}

/**
 * Horizontal intraday option-volume profile.
 *
 * Reading it: strikes run down the Y axis, call volume grows LEFT (red),
 * put volume grows RIGHT (green), and the hairline outline behind each bar
 * is that leg's open interest on the same scale. The gold band is the ATM
 * strike, the dotted line is the top-volume strike.
 */
function NiftyVolumeProfileInner({
  rows,
  spot = null,
  widthPts = 500,
  testId = "nifty-volume-profile",
}: NiftyVolumeProfileProps) {
  const profile = useMemo(
    () => buildVolumeProfile(rows, { widthPts, spot }),
    [rows, widthPts, spot],
  );
  const { points, atmStrike, topStrike, totals } = profile;

  if (points.length === 0) {
    return (
      <CompactPanel title="Volume profile" testId={`${testId}-panel`}>
        <Box
          data-testid={testId}
          sx={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 220 }}
        >
          <Text size="xs" c="dimmed" span>
            No tape data
          </Text>
        </Box>
      </CompactPanel>
    );
  }

  const maxVol = points.reduce((m, p) => Math.max(m, p.ceVol, p.peVol), 0) || 1;
  const maxOi = points.reduce((m, p) => Math.max(m, p.ceOi, p.peOi), 0) || 1;
  // Shared scale: OI outlines sit behind volume bars on the same axis.
  const maxScale = Math.max(maxVol, maxOi);
  const rowH = Math.min(24, Math.max(8, 200 / points.length));
  const svgH = points.length * rowH + 8;

  return (
    <CompactPanel title="Volume profile" testId={`${testId}-panel`}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }}>
        <Box
          data-testid={`${testId}-head`}
          sx={{ display: "flex", alignItems: "baseline", gap: 1.25, flexWrap: "wrap", fontVariantNumeric: "tabular-nums" }}
        >
          <Text size="xs" span c="dimmed">CE vol</Text>
          <Text data-testid={`${testId}-ce-vol`} size="xs" span fw={700} c={CE_FILL}>
            {formatProfileCompact(totals.ceVol)}
          </Text>
          <Text size="xs" span c="dimmed">PE vol</Text>
          <Text data-testid={`${testId}-pe-vol`} size="xs" span fw={700} c={PE_FILL}>
            {formatProfileCompact(totals.peVol)}
          </Text>
          {atmStrike !== null && (
            <Text data-testid={`${testId}-atm-label`} size="xs" span c={palette.TERM_FLIP}>
              ATM {atmStrike.toLocaleString("en-IN")}
            </Text>
          )}
          {topStrike !== null && (
            <Text data-testid={`${testId}-top-label`} size="xs" span c="dimmed">
              Top {topStrike.toLocaleString("en-IN")}
            </Text>
          )}
        </Box>

        <Box sx={{ width: "100%", minWidth: 0, height: 220, overflowY: "auto" }}>
          <svg
            data-testid={testId}
            viewBox={`0 0 ${SVG_W} ${svgH}`}
            role="img"
            aria-label="Call volume left, put volume right by strike"
            style={{ width: "100%", height: Math.max(220, svgH), display: "block" }}
          >
            {/* center axis */}
            <line
              x1={CENTER}
              x2={CENTER}
              y1={0}
              y2={svgH}
              stroke={palette.CHART_BORDER}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            {points.map((p, i) => {
              const y = 4 + i * rowH;
              const h = Math.max(2, rowH - 3);
              const ceW = (p.ceVol / maxScale) * HALF;
              const peW = (p.peVol / maxScale) * HALF;
              const ceOiW = (p.ceOi / maxScale) * HALF;
              const peOiW = (p.peOi / maxScale) * HALF;
              const isAtm = atmStrike !== null && p.strike === atmStrike;
              const isTop = topStrike !== null && p.strike === topStrike;
              return (
                <g
                  key={p.strike}
                  data-testid={`${testId}-row-${p.strike}`}
                  {...(isAtm ? { [`data-atm`]: "true" } : {})}
                  {...(isTop ? { [`data-top`]: "true" } : {})}
                >
                  {isAtm && (
                    <rect
                      data-testid={`${testId}-atm`}
                      x={0}
                      y={y - 1}
                      width={SVG_W}
                      height={h + 2}
                      fill={palette.TERM_FLIP}
                      opacity={0.12}
                    />
                  )}
                  {isTop && (
                    <line
                      data-testid={`${testId}-top`}
                      x1={0}
                      x2={SVG_W}
                      y1={y + h + 0.5}
                      y2={y + h + 0.5}
                      stroke={palette.TEXT}
                      strokeDasharray="2 2"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {/* OI outlines behind the volume bars, same scale */}
                  {p.ceOi > 0 && (
                    <rect
                      x={CENTER - ceOiW}
                      y={y}
                      width={Math.max(1, ceOiW)}
                      height={h}
                      fill="none"
                      stroke={OI_STROKE}
                      strokeWidth={0.75}
                      opacity={0.5}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {p.peOi > 0 && (
                    <rect
                      x={CENTER}
                      y={y}
                      width={Math.max(1, peOiW)}
                      height={h}
                      fill="none"
                      stroke={OI_STROKE}
                      strokeWidth={0.75}
                      opacity={0.5}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {/* volume bars */}
                  {p.ceVol > 0 && (
                    <rect
                      data-testid={`${testId}-ce-${p.strike}`}
                      x={CENTER - ceW}
                      y={y}
                      width={Math.max(1, ceW)}
                      height={h}
                      fill={CE_FILL}
                      opacity={0.85}
                    />
                  )}
                  {p.peVol > 0 && (
                    <rect
                      data-testid={`${testId}-pe-${p.strike}`}
                      x={CENTER}
                      y={y}
                      width={Math.max(1, peW)}
                      height={h}
                      fill={PE_FILL}
                      opacity={0.85}
                    />
                  )}
                  <text
                    x={CENTER}
                    y={y + h / 2 + 3}
                    textAnchor="middle"
                    fontSize={8}
                    fill={isAtm ? palette.TERM_FLIP : palette.TEXT_MUTED}
                    fontWeight={isAtm || isTop ? 700 : 400}
                  >
                    {p.strike.toLocaleString("en-IN")}
                  </text>
                </g>
              );
            })}
          </svg>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, flexWrap: "wrap" }}>
          <Legend color={CE_FILL} label="CE vol" />
          <Legend color={PE_FILL} label="PE vol" />
          <Legend color={OI_STROKE} label="OI outline" outline />
          <Legend color={palette.TERM_FLIP} label="ATM" />
        </Box>
      </Box>
    </CompactPanel>
  );
}

function Legend({ color, label, outline = false }: { color: string; label: string; outline?: boolean }) {
  return (
    <Box data-testid={`nifty-volume-profile-legend-${label}`} sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
      <Box
        aria-hidden
        sx={{
          width: 10,
          height: 6,
          borderRadius: 0.5,
          bgcolor: outline ? "transparent" : color,
          border: outline ? `1px solid ${color}` : undefined,
        }}
      />
      <Text size="xs" c="dimmed" span>
        {label}
      </Text>
    </Box>
  );
}

/** Memoised leaf panel — `rows` keeps identity between unrelated parent renders. */
export const NiftyVolumeProfile = memo(NiftyVolumeProfileInner);
NiftyVolumeProfile.displayName = "NiftyVolumeProfile";
