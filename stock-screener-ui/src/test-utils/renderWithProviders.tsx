import { render } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import type { JSX } from "solid-js";

/**
 * Mount a component under the app's providers.
 *
 * No router here on purpose. In `@solidjs/router` v1 the router only renders
 * `<Route>` definitions — arbitrary JSX children produce zero routes, so a
 * router wrapper rendered an empty tree for every consumer. Components that
 * need navigation should either declare their routes or mock
 * `useNavigate`/`useSearchParams` (the pattern the converted suites use), which
 * also keeps them hermetic from route-table changes.
 */
export function renderWithProviders(
  ui: () => JSX.Element,
  _options?: { initialRoute?: string; user?: unknown },
): ReturnType<typeof render> {
  return render(ui, {
    wrapper: (props) => <UIProvider>{props.children}</UIProvider>,
  });
}

export function renderWithRouter(ui: () => JSX.Element): ReturnType<typeof render> {
  return render(ui, {
    wrapper: (props) => <UIProvider>{props.children}</UIProvider>,
  });
}