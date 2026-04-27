/**
 * Shared test utilities for component testing
 */

import { MantineProvider } from "@mantine/core";
import { render, RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Standard wrapper for tests that need Mantine UI context
 */
export function TestWrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
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
