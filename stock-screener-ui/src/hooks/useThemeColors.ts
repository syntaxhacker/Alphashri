import { useMantineColorScheme, useMantineTheme, rem, type MantineColor } from "@mantine/core";

export function useThemeColors() {
  const { colorScheme } = useMantineColorScheme();
  const theme = useMantineTheme();
  const isDark = colorScheme === "dark";

  return {
    isDark,
    colorScheme,
    theme,

    background: isDark ? theme.colors.dark[9] : theme.white,
    surface: isDark ? theme.colors.dark[7] : theme.colors.gray[0],
    border: isDark ? theme.colors.dark[4] : theme.colors.gray[3],
    text: isDark ? theme.white : theme.black,
    textSecondary: isDark ? theme.colors.dark[0] : theme.colors.gray[7],

    bg: (lightColor: MantineColor, darkColor: MantineColor) =>
      isDark
        ? theme.colors[darkColor as keyof typeof theme.colors]?.[6]
        : theme.colors[lightColor as keyof typeof theme.colors]?.[0],

    color: (light: string, dark: string) => (isDark ? dark : light),

    spacing: (size: keyof typeof theme.spacing) => rem(theme.spacing[size]),

    radius: (size: keyof typeof theme.radius) => rem(theme.radius[size]),
  };
}

export type ThemeColors = ReturnType<typeof useThemeColors>;

export function resolveColor(isDark: boolean, light: string, dark: string): string {
  return isDark ? dark : light;
}
