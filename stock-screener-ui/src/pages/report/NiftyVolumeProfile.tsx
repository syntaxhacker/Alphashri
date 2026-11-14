import { formatNumberIN } from "@/utils/ui-helpers";
import { createMemo, For, Show } from "solid-js";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { LocalCompactPanel } from "./reportBits";
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
export function NiftyVolumeProfile(props: NiftyVolumeProfileProps) {
  const testId = () => props.testId ?? "nifty-volume-profile";

  const profile = createMemo(() =>
    buildVolumeProfile(props.rows, {
      widthPts: props.widthPts ?? 500,
      spot: props.spot ?? null,
    }),
  );
  const points = () => profile().points;
  const atmStrike = () => profile().atmStrike;
  const topStrike = () => profile().topStrike;
  const totals = () => profile().totals;

  const maxVol = createMemo(() => points().reduce((m, p) => Math.max(m, p.ceVol, p.peVol), 0) || 1);
  const maxOi = createMemo(() => points().reduce((m, p) => Math.max(m, p.ceOi, p.peOi), 0) || 1);
  // Shared scale: OI outlines sit behind volume bars on the same axis.
  const maxScale = createMemo(() => Math.max(maxVol(), maxOi()));
  const rowH = createMemo(() => Math.min(24, Math.max(8, 200 / Math.max(points().length, 1))));
  const svgH = createMemo(() => points().length * rowH() + 8);

  return (
    <Show
      when={points().length > 0}
      fallback={
        <LocalCompactPanel title="Volume profile" testId={`${testId()}-panel`}>
          <div
            data-testid={testId()}
            class="flex items-center justify-center min-h-[220px]"
          >
            <Text size="xs" c="dimmed" span>
              No tape data
            </Text>
          </div>
        </LocalCompactPanel>
      }
    >
      <LocalCompactPanel title="Volume profile" testId={`${testId()}-panel`}>
        <div class="flex flex-col gap-[4px] min-w-0">
          <div
            data-testid={`${testId()}-head`}
            class="flex items-baseline gap-[10px] flex-wrap tabular-nums"
          >
            <Text size="xs" span c="dimmed">CE vol</Text>
            <Text data-testid={`${testId()}-ce-vol`} size="xs" span fw={700} c={CE_FILL}>
              {formatProfileCompact(totals().ceVol)}
            </Text>
            <Text size="xs" span c="dimmed">PE vol</Text>
            <Text data-testid={`${testId()}-pe-vol`} size="xs" span fw={700} c={PE_FILL}>
              {formatProfileCompact(totals().peVol)}
            </Text>
            <Show when={atmStrike() !== null}>
              <Text data-testid={`${testId()}-atm-label`} size="xs" span c={palette.TERM_FLIP}>
                ATM {formatNumberIN(atmStrike()!)}
              </Text>
            </Show>
            <Show when={topStrike() !== null}>
              <Text data-testid={`${testId()}-top-label`} size="xs" span c="dimmed">
                Top {formatNumberIN(topStrike()!)}
              </Text>
            </Show>
          </div>

          <div class="w-full min-w-0" style={{ height: "220px", "overflow-y": "auto" }}>
            <svg
              data-testid={testId()}
              viewBox={`0 0 ${SVG_W} ${svgH()}`}
              role="img"
              aria-label="Call volume left, put volume right by strike"
              style={{ width: "100%", height: `${Math.max(220, svgH())}px`, display: "block" }}
            >
              {/* center axis */}
              <line
                x1={CENTER}
                x2={CENTER}
                y1={0}
                y2={svgH()}
                stroke={palette.CHART_BORDER}
                stroke-width={1}
                vector-effect="non-scaling-stroke"
              />
              <For each={points()}>{(p, i) => {
                const y = 4 + i() * rowH();
                const h = Math.max(2, rowH() - 3);
                const ceW = (p.ceVol / maxScale()) * HALF;
                const peW = (p.peVol / maxScale()) * HALF;
                const ceOiW = (p.ceOi / maxScale()) * HALF;
                const peOiW = (p.peOi / maxScale()) * HALF;
                const isAtm = atmStrike() !== null && p.strike === atmStrike();
                const isTop = topStrike() !== null && p.strike === topStrike();
                return (
                  <g
                    data-testid={`${testId()}-row-${p.strike}`}
                    data-atm={isAtm ? "true" : undefined}
                    data-top={isTop ? "true" : undefined}
                  >
                    <Show when={isAtm}>
                      <rect
                        data-testid={`${testId()}-atm`}
                        x={0}
                        y={y - 1}
                        width={SVG_W}
                        height={h + 2}
                        fill={palette.TERM_FLIP}
                        opacity={0.12}
                      />
                    </Show>
                    <Show when={isTop}>
                      <line
                        data-testid={`${testId()}-top`}
                        x1={0}
                        x2={SVG_W}
                        y1={y + h + 0.5}
                        y2={y + h + 0.5}
                        stroke={palette.TEXT}
                        stroke-dasharray="2 2"
                        stroke-width={1}
                        vector-effect="non-scaling-stroke"
                      />
                    </Show>
                    {/* OI outlines behind the volume bars, same scale */}
                    <Show when={p.ceOi > 0}>
                      <rect
                        x={CENTER - ceOiW}
                        y={y}
                        width={Math.max(1, ceOiW)}
                        height={h}
                        fill="none"
                        stroke={OI_STROKE}
                        stroke-width={0.75}
                        opacity={0.5}
                        vector-effect="non-scaling-stroke"
                      />
                    </Show>
                    <Show when={p.peOi > 0}>
                      <rect
                        x={CENTER}
                        y={y}
                        width={Math.max(1, peOiW)}
                        height={h}
                        fill="none"
                        stroke={OI_STROKE}
                        stroke-width={0.75}
                        opacity={0.5}
                        vector-effect="non-scaling-stroke"
                      />
                    </Show>
                    {/* volume bars */}
                    <Show when={p.ceVol > 0}>
                      <rect
                        data-testid={`${testId()}-ce-${p.strike}`}
                        x={CENTER - ceW}
                        y={y}
                        width={Math.max(1, ceW)}
                        height={h}
                        fill={CE_FILL}
                        opacity={0.85}
                      />
                    </Show>
                    <Show when={p.peVol > 0}>
                      <rect
                        data-testid={`${testId()}-pe-${p.strike}`}
                        x={CENTER}
                        y={y}
                        width={Math.max(1, peW)}
                        height={h}
                        fill={PE_FILL}
                        opacity={0.85}
                      />
                    </Show>
                    <text
                      x={CENTER}
                      y={y + h / 2 + 3}
                      text-anchor="middle"
                      font-size="8"
                      fill={isAtm ? palette.TERM_FLIP : palette.TEXT_MUTED}
                      font-weight={isAtm || isTop ? 700 : 400}
                    >
                      {formatNumberIN(p.strike)}
                    </text>
                  </g>
                );
              }}</For>
            </svg>
          </div>

          <div class="flex items-center gap-[10px] flex-wrap">
            <Legend color={CE_FILL} label="CE vol" />
            <Legend color={PE_FILL} label="PE vol" />
            <Legend color={OI_STROKE} label="OI outline" outline />
            <Legend color={palette.TERM_FLIP} label="ATM" />
          </div>
        </div>
      </LocalCompactPanel>
    </Show>
  );
}

function Legend(props: { color: string; label: string; outline?: boolean }) {
  return (
    <div data-testid={`nifty-volume-profile-legend-${props.label}`} class="flex items-center gap-[4px] shrink-0">
      <div
        aria-hidden="true"
        class="w-[10px] h-[4px] rounded-[4px]"
        style={{
          "background-color": props.outline ? "transparent" : props.color,
          border: props.outline ? `1px solid ${props.color}` : undefined,
        }}
      />
      <Text size="xs" c="dimmed" span>
        {props.label}
      </Text>
    </div>
  );
}
