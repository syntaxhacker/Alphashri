import { useMantineColorScheme, useMantineTheme, rem } from "@mantine/core";
import { useDebouncedValue, useMediaQuery, useDisclosure } from "@mantine/hooks";
import type { UIUseColorSchemeResult } from "./types";

export { useDebouncedValue, useMediaQuery, rem, useDisclosure };
export { useTree, getTreeExpandedState } from "@mantine/core";

export function useColorScheme(): UIUseColorSchemeResult {
  const { colorScheme, toggleColorScheme, setColorScheme } = useMantineColorScheme();
  return {
    isDark: colorScheme === "dark",
    colorScheme,
    toggleColorScheme,
    setColorScheme,
  };
}

export function useTheme() {
  return useMantineTheme();
}

export function useMantineCore() {
  return { useMantineColorScheme, useMantineTheme };
}
