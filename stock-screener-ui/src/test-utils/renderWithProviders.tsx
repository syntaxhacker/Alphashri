import { render } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { createMemoryHistory, MemoryRouter } from "@solidjs/router";
import type { JSX } from "solid-js";

function TestWrapper(props: { children: JSX.Element; initialRoute?: string }) {
  const history = createMemoryHistory();
  history.set({ value: props.initialRoute ?? "/", replace: true, scroll: false });
  return (
    <MemoryRouter history={history}>
      <UIProvider>{props.children}</UIProvider>
    </MemoryRouter>
  );
}

export function renderWithProviders(
  ui: () => JSX.Element,
  options?: { initialRoute?: string; user?: unknown },
): ReturnType<typeof render> {
  return render(ui, {
    wrapper: (props) => <TestWrapper initialRoute={options?.initialRoute}>{props.children}</TestWrapper>,
  });
}

export function renderWithRouter(ui: () => JSX.Element): ReturnType<typeof render> {
  return render(ui, { wrapper: TestWrapper });
}
