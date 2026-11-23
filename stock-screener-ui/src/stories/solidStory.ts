import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import * as palette from "@/ui/palette";

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
  // A surfaced canvas keeps panels, tables and bare controls readable against
  // the page; the app itself uses BG, but a story screenshot is a specimen,
  // not a blank terminal screen.
  host.style.cssText = `min-height:100%;background:${palette.SURFACE};color:${palette.TEXT};padding:20px;box-sizing:border-box`;
  activeRoots.push(render(component, host));
  return host;
}
