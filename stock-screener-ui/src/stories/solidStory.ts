import { render } from "solid-js/web";
import type { JSX } from "solid-js";

/**
 * Storybook's html-vite renderer expects a DOM node. Solid has no React-style
 * portable runtime, so each story mounts once into its own host.
 */
const activeRoots: Array<ReturnType<typeof render>> = [];

/** Dispose every Solid root mounted by `solidStory` for the finished story. */
export function disposeSolidStories(): void {
  while (activeRoots.length > 0) {
    try {
      activeRoots.pop()?.();
    } catch {
      // A story cleanup must not break navigation to the next story.
    }
  }
}

export function solidStory(component: () => JSX.Element): HTMLElement {
  const host = document.createElement("div");
  // Transparent so the component shows against Storybook's own canvas colours;
  // padding just keeps it off the canvas edges.
  host.style.cssText = "min-height:100%;padding:16px;box-sizing:border-box;background:transparent;color:inherit";
  activeRoots.push(render(component, host));
  return host;
}
