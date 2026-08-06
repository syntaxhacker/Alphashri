/**
 * Shared test utilities for component testing
 */

import { UIProvider } from "@/ui";
import { render, RenderResult } from "@testing-library/react";

/**
 * Standard wrapper for tests that need Mantine UI context
 */
export function TestWrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

/**
 * Render helper that automatically wraps with MantineProvider
 */
export function renderWithMantine(
  ui: React.ReactElement,
  options?: Parameters<typeof render>[1],
): RenderResult {
  return render(ui, { wrapper: TestWrapper, ...options });
}
