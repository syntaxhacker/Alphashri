import type { ReactElement, ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { BrowserRouter } from "react-router-dom";

function TestWrapper({ children }: { children: ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

export function renderWithMantine(ui: ReactElement): RenderResult {
  return render(ui, { wrapper: TestWrapper });
}

export function renderWithRouter(ui: ReactElement): RenderResult {
  return render(<MantineProvider><BrowserRouter>{ui}</BrowserRouter></MantineProvider>);
}
