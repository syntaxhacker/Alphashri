// Legacy stub — MUI theme is now in src/ui/muiTheme.ts and provided via ThemeProvider in src/main.tsx / .storybook/preview.tsx
export const uiTheme = {} as any;

export function UIProvider({ children }: { children: React.ReactNode; defaultColorScheme?: "light" | "dark"; forceColorScheme?: "light" | "dark" }) {
  return <>{children}</>;
}
