import { onCleanup, onMount } from "solid-js";
import { useSymbolDock } from "./symbolDockContext";

export function ChartDockOutlet(props: { class?: string }) {
  const dock = useSymbolDock();
  let el: HTMLDivElement | undefined;

  onMount(() => {
    if (el) dock.setOutlet(el);
  });
  onCleanup(() => dock.setOutlet(null));

  return (
    <div
      ref={(node) => {
        el = node;
      }}
      data-testid="chart-dock-outlet"
      data-dock-open="false"
      class={props.class}
    />
  );
}
