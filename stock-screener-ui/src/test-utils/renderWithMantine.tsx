import type { ReactElement, ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { UIProvider } from "@/ui";
import { BrowserRouter } from "react-router-dom";

function TestWrapper({ children }: { children: ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

export function renderWithMantine(ui: ReactElement): RenderResult {
  return render(ui, { wrapper: TestWrapper });
}

export function renderWithRouter(ui: ReactElement): RenderResult {
  return render(<UIProvider><BrowserRouter>{ui}</BrowserRouter></UIProvider>);
}
