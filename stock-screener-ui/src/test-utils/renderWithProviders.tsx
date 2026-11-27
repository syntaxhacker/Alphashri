import { render } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import type { JSX } from "solid-js";

/**
 * The one UIProvider wrapper shared by every component test.
 *
 * No router here on purpose. In `@solidjs/router` v1 the router only renders
 * `<Route>` definitions — arbitrary JSX children produce zero routes, so a
 * router wrapper rendered an empty tree for every consumer. Components that
 * need navigation should either declare their routes or mock
 * `useNavigate`/`useSearchParams` (the pattern the converted suites use), which
 * also keeps them hermetic from route-table changes.
 */
export function TestWrapper(props: { children: JSX.Element }) {
  return <UIProvider>{props.children}</UIProvider>;
}

/**
 * Render a zero-arg component under the canonical provider.
 *
 * `options` are spread after the default wrapper so callers keep Solid's full
 * render contract (container, queries, a narrower wrapper, …) without forking
 * a second helper.
 */
export function renderWithProviders(
  ui: () => JSX.Element,
  options?: Parameters<typeof render>[1],
): ReturnType<typeof render> {
  return render(ui, { wrapper: TestWrapper, ...options });
}
