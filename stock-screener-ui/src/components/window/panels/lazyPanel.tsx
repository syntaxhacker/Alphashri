import { lazy, Suspense, type Accessor, type JSX } from "solid-js";
import { Box, Loader, Text } from "@/ui";
import type { DockPanelApi, DockPanelContext, DockPanelSpec } from "../../dock/types";

export interface LazyPanelProps {
  ctx: Accessor<DockPanelContext>;
  api: DockPanelApi;
}

/** Fills the window body so a late chunk never shifts the frame or flashes blank. */
export function PanelSkeleton(props: { id: string; title: string }) {
  return (
    <Box
      data-testid={`panel-skeleton-${props.id}`}
      className="flex h-full min-h-0 items-center justify-center gap-2 p-3"
    >
      <Loader size="sm" />
      <Text size="xs" c="dimmed">Loading {props.title}…</Text>
    </Box>
  );
}

/**
 * Keeps a panel's identity (id/title/geometry/data) synchronous while its code
 * and component graph load on first mount. The registry stays the single lookup
 * path; only `mount` becomes deferred. `load` resolves the panel's own spec so
 * metadata has one owner and cannot drift from the lazy descriptor.
 */
export function lazyPanelSpec(
  meta: Omit<DockPanelSpec, "mount">,
  load: () => Promise<DockPanelSpec>,
): DockPanelSpec {
  const LazyPanel = lazy(async () => {
    const spec = await load();
    return {
      default: (props: LazyPanelProps): JSX.Element => spec.mount(props.ctx, props.api),
    };
  });

  return {
    ...meta,
    mount: (ctx, api) => (
      <Suspense fallback={<PanelSkeleton id={meta.id} title={meta.title} />}>
        <LazyPanel ctx={ctx} api={api} />
      </Suspense>
    ),
  };
}
