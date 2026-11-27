import { For, Show } from "solid-js";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { fmtNum } from "./niftyWallsFormat";
import {
  REPORT_FONT,
  REPORT_LINE_HEIGHT,
  REPORT_PAD,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
} from "./reportTokens";

export function Stat(props: { label: string; value: string; color?: string }) {
  return (
    <div class="flex min-w-0 flex-col gap-[2px] py-[2px]">
      <Text
        size="xs"
        span
        className="block"
        fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
        style={{
          "font-size": `${REPORT_FONT.micro}px`,
          "line-height": REPORT_LINE_HEIGHT.tight,
          color: palette.TEXT_MUTED,
          "letter-spacing": REPORT_LETTER_SPACING.wide,
        }}
      >
        {props.label}
      </Text>
      <Text
        size="xs"
        span
        fw={REPORT_FONT_WEIGHT.bold as "normal" | "medium" | "semibold" | "bold" | number}
        className="block font-mono tabular-nums whitespace-nowrap overflow-hidden truncate"
        title={props.value}
        style={{
          "font-size": `${REPORT_FONT.md}px`,
          "line-height": REPORT_LINE_HEIGHT.snug,
          color: props.color ?? palette.TEXT_COLOR,
          "white-space": "nowrap",
          overflow: "hidden",
          "text-overflow": "ellipsis",
        }}
      >
        {props.value}
      </Text>
    </div>
  );
}

/**
 * Report-wide level key: CW (call wall / resistance, red), PW (put wall /
 * support, green) and MP (max pain, amber). The coloured dot carries the code;
 * the label sits on the panel surface, never on a saturated fill.
 */
export function WallsLevelsLegend(props: {
  callWall: number | null;
  putWall: number | null;
  maxPain: number | null;
  skeleton?: boolean;
}) {
  const items = () => [
    {
      code: "CW",
      title: "CW · call wall — highest-OI call strike; resistance defended by call writers",
      color: palette.LEVEL_CALL_WALL,
      value: props.callWall,
    },
    {
      code: "PW",
      title: "PW · put wall — highest-OI put strike; support defended by put writers",
      color: palette.LEVEL_PUT_WALL,
      value: props.putWall,
    },
    {
      code: "MP",
      title: "MP · max pain — the strike where the most options expire worthless",
      color: palette.LEVEL_MAX_PAIN,
      value: props.maxPain,
    },
  ];
  return (
    <div
      data-testid="nifty-walls-levels-legend"
      class="flex flex-wrap items-center"
      style={{
        gap: `${REPORT_PAD.xs}px`,
        "font-size": `${REPORT_FONT.micro}px`,
        "line-height": REPORT_LINE_HEIGHT.tight,
        color: palette.TEXT_MUTED,
      }}
    >
      <For each={items()}>{(item, i) => (
        <>
          <Show when={i() > 0}>
            <span aria-hidden="true">·</span>
          </Show>
          <span
            data-testid={`nifty-walls-levels-legend-${item.code.toLowerCase()}`}
            title={item.title}
            class="inline-flex items-center gap-[4px] whitespace-nowrap"
          >
            <span
              aria-hidden="true"
              class="inline-block shrink-0 rounded-full w-[6px] h-[6px]"
              style={{ "background-color": item.color }}
            />
            <span class="text-ui-micro">{item.code}</span> <span class="text-ui-body font-mono tabular-nums">{props.skeleton ? "—" : fmtNum(item.value)}</span>
          </span>
        </>
      )}</For>
    </div>
  );
}
