/**
 * Shared test utilities for component testing
 */

import { UIProvider } from "@/ui";
import { render } from "@solidjs/testing-library";
import type { JSX } from "solid-js";

/**
 * Standard wrapper for tests that need the local `@/ui` provider context
 */
export function TestWrapper(props: { children: JSX.Element }) {
  return <UIProvider>{props.children}</UIProvider>;
}

/**
 * Render helper that automatically wraps with UIProvider
 */
export function renderWithProviders(
  ui: () => JSX.Element,
  options?: Parameters<typeof render>[1],
): ReturnType<typeof render> {
  return render(ui, { wrapper: TestWrapper, ...options });
}
