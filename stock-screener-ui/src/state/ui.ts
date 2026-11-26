import { createSignal } from "solid-js";

/** True while the temporary 168px mobile nav drawer is open. The drawer lives
 *  in AppLayout as local state; page surfaces that must yield their band to an
 *  overlay (e.g. Home's pulse and catalyst strips) read this instead. */
const [mobileDrawerOpen, setMobileDrawerOpen] = createSignal(false);

export { mobileDrawerOpen, setMobileDrawerOpen };
