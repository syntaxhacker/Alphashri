import type { MantineTheme } from "@mantine/core";
import { POSITIVE, NEGATIVE, BULLISH, BEARISH } from "../config/colors";

export function getChartThemeColors(isDark: boolean, theme: MantineTheme | Record<string, any>) {
  return {
    bgColor: isDark ? theme.colors.dark[7] : theme.white,
    textColor: isDark ? theme.white : theme.colors.gray[8],
    gridLineColor: isDark ? theme.colors.dark[5] : theme.colors.gray[2],
    borderColor: isDark ? theme.colors.dark[4] : theme.colors.gray[3],
    mutedColor: isDark ? theme.colors.dark[1] : theme.colors.gray[6],
    positiveColor: POSITIVE,
    negativeColor: NEGATIVE,
  };
}

export const CANDLESTICK_ITEM_STYLE = {
  color: BULLISH,
  color0: BEARISH,
  borderColor: BULLISH,
  borderColor0: BEARISH,
};

export function formatVolume(vol: number): string {
  if (vol >= 1000000) return (vol / 1000000).toFixed(1) + "M";
  if (vol >= 1000) return (vol / 1000).toFixed(1) + "K";
  return vol.toString();
}
