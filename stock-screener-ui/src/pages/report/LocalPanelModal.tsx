/**
 * Report-desk alias for the shared PanelModal. Kept as a named module because
 * the report pages import it locally, but the shell, focus cycle, Escape and
 * backdrop all live in @/ui Modal through PanelModal — there is no second
 * overlay implementation here.
 */
import type { JSX } from "solid-js";
import {
  PanelModal,
  type PanelModalProps,
} from "@/components/common/PanelModal";

export interface LocalPanelModalProps extends Omit<PanelModalProps, "children"> {
  children: JSX.Element;
}

export function LocalPanelModal(props: LocalPanelModalProps) {
  return <PanelModal {...props} />;
}
