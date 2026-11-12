import { render, type RenderResult } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { Router } from "@solidjs/router";
import type { JSX } from "solid-js";

function TestWrapper({ children }: { children: JSX.Element }) {
  return <UIProvider>{children}</UIProvider>;
}

export function renderWithProviders(ui: JSX.Element, options?: { initialRoute?: string; user?: unknown }): RenderResult {
  return render(ui, { wrapper: TestWrapper });
}

export function renderWithRouter(ui: JSX.Element): RenderResult {
  function RouterWrapper({ children }: { children: JSX.Element }) {
    return (
      <Router>
        <UIProvider>{children}</UIProvider>
      </Router>
    );
  }
  return render(ui, { wrapper: RouterWrapper });
}
