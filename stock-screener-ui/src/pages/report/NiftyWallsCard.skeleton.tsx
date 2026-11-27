import { Show } from "solid-js";
import type { JSX } from "solid-js";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { ReplayUnavailable } from "./BreadthStrip";
import {
  REPORT_FONT,
  REPORT_PAD,
  REPORT_RADIUS,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
} from "./reportTokens";
import { WALLS_RESERVED_H } from "./NiftyWallsCard.shared";
import { WallsLevelsLegend } from "./NiftyWallsCard.stats";
import { WallTable } from "./NiftyWallsCard.table";

/** Muted placeholder block used by the null-payload skeleton. */
export function SkeletonBar(props: { height: number; width?: number | string }) {
  return (
    <div
      style={{
        height: `${props.height}px`,
        width: typeof props.width === "number" ? `${props.width}px` : props.width ?? "100%",
        "border-radius": `${REPORT_RADIUS.sm}px`,
        "background-color": palette.SURFACE_ALT,
      }}
    />
  );
}

/** Mirrors the `Stat` block (label over value) so the reserved stats column
 *  keeps the height of the live one. */
export function SkeletonStat() {
  return (
    <div class="min-w-0 py-[2px]">
      <SkeletonBar height={12} width="42%" />
      <SkeletonBar height={15} width="68%" />
    </div>
  );
}

/** The levels rows live inside this card in both states — dropping them on a
 *  null payload would change the card height by the levels band. */
export function WallsLevelsBlock(props: { levels?: JSX.Element }) {
  if (!props.levels) return null;
  return (
    <div
      style={{
        "border-top": `1px solid ${palette.alpha(palette.BORDER, 0.6)}`,
        "padding-top": `${REPORT_PAD.sm}px`,
        "min-width": 0,
      }}
    >
      {props.levels}
    </div>
  );
}

/** Null-payload skeleton: same bands, same row counts and the same reserved
 *  heights as the populated card, so the one-page Index Report never reflows
 *  when the walls payload arrives.
 *
 *  Height budget: the CALL/PUT tables are the tallest band (~21px header +
 *  3 rows of ~31px ≈ 114px) and both states render exactly three rows per
 *  side, so the skeleton body lands on the same height as the populated one.
 *  The READ/SEQ and tracked-history bands are reserved at 96px so they can
 *  never collapse below the live bands. */
export function WallsSkeleton(props: { emptyText: string; replayUnavailable?: boolean }) {
  return (
    <div
      data-testid="nifty-walls-skeleton"
      class="grid gap-[8px] p-[8px] items-start"
      style={{
        display: "grid",
        "grid-template-columns": "minmax(0,1fr)",
        gap: `${REPORT_PAD.sm}px`,
        padding: `${REPORT_PAD.sm}px`,
        "align-items": "start",
      }}
    >
      <div data-testid="nifty-walls-skeleton-strip" class="min-w-0">
        <div class="flex items-center flex-wrap gap-2" style={{ "align-items": "center", "flex-wrap": "wrap", "row-gap": `${REPORT_PAD.xs}px` }}>
          <SkeletonBar height={18} width={64} />
          <SkeletonBar height={12} width={46} />
          <SkeletonBar height={12} width={108} />
        </div>
        <div
          style={{
            display: "grid",
            "grid-template-columns": "1fr 1fr",
            "column-gap": `${REPORT_PAD.md}px`,
            "row-gap": `${REPORT_PAD.xs}px`,
            "margin-top": `${REPORT_PAD.sm}px`,
          }}
        >
          <SkeletonStat />
          <SkeletonStat />
          <SkeletonStat />
          <SkeletonStat />
        </div>
        <div style={{ "margin-top": `${REPORT_PAD.xs}px` }}>
          <WallsLevelsLegend callWall={null} putWall={null} maxPain={null} skeleton />
        </div>
        <Show
          when={props.replayUnavailable}
          fallback={
            <Text
              size="xs"
              span
              style={{
                "font-size": `${REPORT_FONT.xs}px`,
                color: palette.TEXT_MUTED,
                "margin-top": `${REPORT_PAD.xs}px`,
              }}
            >
              {props.emptyText}
            </Text>
          }
        >
          <ReplayUnavailable noun="Walls" />
        </Show>
      </div>

      <WallTable side="CALL" rows={[]} spot={0} />
      <WallTable side="PUT" rows={[]} spot={0} />

      <div
        data-testid="nifty-walls-skeleton-read"
        style={{
          "min-height": `${WALLS_RESERVED_H}px`,
          "min-width": 0,
          "border-left": `1px solid ${palette.alpha(palette.BORDER, 0.6)}`,
          "padding-left": `${REPORT_PAD.sm}px`,
          display: "flex",
          "flex-direction": "column",
          gap: `${REPORT_PAD.xs}px`,
        }}
      >
        <Text
          size="xs"
          span
          fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
          style={{
            "font-size": `${REPORT_FONT.micro}px`,
            "font-weight": REPORT_FONT_WEIGHT.extrabold,
            color: palette.TEXT_MUTED,
            "letter-spacing": REPORT_LETTER_SPACING.wider,
          }}
        >
          READ
        </Text>
        <SkeletonBar height={10} width="92%" />
        <SkeletonBar height={10} width="76%" />
        <SkeletonBar height={10} width="84%" />
        <Text
          size="xs"
          span
          fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
          style={{
            "font-size": `${REPORT_FONT.micro}px`,
            "font-weight": REPORT_FONT_WEIGHT.extrabold,
            color: palette.TEXT_MUTED,
            "letter-spacing": REPORT_LETTER_SPACING.wider,
            "margin-top": `${REPORT_PAD.sm}px`,
          }}
        >
          SEQ
        </Text>
        <SkeletonBar height={10} width="60%" />
      </div>

      <div
        data-testid="nifty-walls-skeleton-history"
        style={{
          "min-height": `${WALLS_RESERVED_H}px`,
          "min-width": 0,
          display: "flex",
          "flex-direction": "column",
          gap: `${REPORT_PAD.xs}px`,
        }}
      >
        <SkeletonBar height={11} width="58%" />
        <SkeletonBar height={10} width="34%" />
        <SkeletonBar height={18} />
        <SkeletonBar height={10} width="34%" />
        <SkeletonBar height={18} />
      </div>
    </div>
  );
}
