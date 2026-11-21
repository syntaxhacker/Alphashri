// ChartErrorBoundary — keeps a chart crash from unmounting the whole page.
import { createEffect, createSignal, ErrorBoundary, Show } from "solid-js";
import { Text, Box } from "@/ui";
interface Props {
  children: JSX.Element;
  resetKey?: unknown;
}

export function ChartErrorBoundary(props: Props) {
  const [error, setError] = createSignal<Error | null>(null);

  // A new resetKey clears the captured error so the chart remounts and retries.
  createEffect(() => {
    void props.resetKey;
    setError(null);
  });

  const errorBox = (
    <Box className="flex items-center justify-center p-2 h-full">
      <Text size="xs" c="error">
        Chart failed to render: {String(error()?.message ?? error())}
      </Text>
    </Box>
  );

  return (
    <>
      <Show when={!error()}>
        <ErrorBoundary fallback={(err) => { setError(err); return errorBox; }}>
          {props.children}
        </ErrorBoundary>
      </Show>
      <Show when={error()}>{errorBox}</Show>
    </>
  );
}
