import { ActionIcon, useMantineColorScheme, useComputedColorScheme } from "@mantine/core";

export function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("dark", { getInitialValueInEffect: true });

  return (
    <ActionIcon
      onClick={() => setColorScheme(computedColorScheme === "light" ? "dark" : "light")}
      variant="subtle"
      size="lg"
      aria-label="Toggle color scheme"
    >
      {computedColorScheme === "light" ? "🌙" : "☀️"}
    </ActionIcon>
  );
}
