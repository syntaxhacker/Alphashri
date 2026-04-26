import type { ReactElement, ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";

function TestWrapper({ children }: { children: ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

export function renderWithMantine(ui: ReactElement): RenderResult {
  return render(ui, { wrapper: TestWrapper });
}
