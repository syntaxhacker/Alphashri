import { createSignal, onCleanup, onMount } from "solid-js";
import { phoneViewport } from "./NiftyChartPanel.range";

/** The phone gutter is breakpoint-driven, not width-sampled: keep the media
 *  query live so a rotation or a resize changes the axis lane without a
 *  remount of the chart engine. */
export function usePhoneViewport() {
  const [phone, setPhone] = createSignal(phoneViewport());
  onMount(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 600px)");
    setPhone(mq.matches);
    const onChange = (event: MediaQueryListEvent) => setPhone(event.matches);
    mq.addEventListener("change", onChange);
    onCleanup(() => mq.removeEventListener("change", onChange));
  });
  return phone;
}
