# Test render helpers

This directory owns the **one** canonical render wrapper used by frontend
component tests. There is exactly one copy — do not add a second.

## Canonical imports

Import the render helper from `@/test-utils/renderWithProviders`:

```typescript
import { renderWithProviders } from "@/test-utils/renderWithProviders";

renderWithProviders(() => <MyComponent />);
```

`renderWithProviders` renders a zero-arg component under the app's `UIProvider`
and forwards Solid's render options. Options are spread **after** the default
wrapper, so callers keep the full render contract (`container`, queries, or a
narrower `wrapper`) without forking a helper:

```typescript
renderWithProviders(() => <MyComponent />, { container: myContainer });
```

`TestWrapper` is exported from the same module for the rare case where you must
call Solid's `render()` directly or nest an explicit `<TestWrapper>` in JSX:

```typescript
import { render } from "@solidjs/testing-library";
import { TestWrapper } from "@/test-utils/renderWithProviders";

render(() => <MyComponent />, { wrapper: TestWrapper });
```

The old `src/test/test-utils.tsx` re-export shim is **removed**. Import from the
canonical path above; the guard in `src/test/no-legacy-test-utils.test.ts` fails
if the shim returns or if anything imports the legacy `test/test-utils` path.

## No-duplicate-render-wrapper rule

**Do not create another render wrapper.** A local `TestWrapper` /
`renderWithProviders` in a test file is a review blocker: a second copy can
silently diverge on option handling (one historical copy discarded render
options entirely). Need a different provider (router, auth)? Pass a custom
`wrapper` option to `renderWithProviders` instead of adding a new helper.

## Other helpers here

- `solidUiMock.tsx` — test-only `@/ui` stand-in (`@/test-utils/solidUiMock`).
- `solidRenderHook.ts` — render-hook helper.
- `setupBrowser.ts` — browser setup.
- `renderWithProviders.test.tsx` — contract test for the canonical wrapper.

See `TEST_RULES.md` → *Setup Patterns* for the full testing conventions.
