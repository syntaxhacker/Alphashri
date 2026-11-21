import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import * as palette from "@/ui/palette";

/**
 * Storybook's html-vite renderer expects a DOM node. Solid has no React-style
 * portable runtime, so each story mounts once into its own host.
 */
export function solidStory(component: () => JSX.Element): HTMLElement {
  const host = document.createElement("div");
  host.style.cssText = `min-height:100%;background:${palette.BG_COLOR};color:${palette.TEXT_COLOR};padding:12px`;
  render(component, host);
  return host;
}
