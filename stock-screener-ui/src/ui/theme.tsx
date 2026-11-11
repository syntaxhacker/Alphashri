// Local UI provider stub. Styling is provided by Tailwind tokens + sxTheme.
import type { ReactNode } from "react";

export const uiTheme = {} as any;

export function UIProvider({ children }: { children: ReactNode; defaultColorScheme?: "light" | "dark"; forceColorScheme?: "light" | "dark" }) {
  return <>{children}</>;
}
